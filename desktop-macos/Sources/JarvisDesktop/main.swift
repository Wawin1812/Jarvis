import AppKit
import AVFoundation
import CoreGraphics
import Foundation
import Security
import Speech
import ScreenCaptureKit

private let keychainService = "com.jarvis.desktop"
private let keychainAccount = "api-token"

@main
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var statusLabel: NSTextField!
    private var backendField: NSTextField!
    private var tokenField: NSSecureTextField!
    private var commandField: NSTextField!
    private var outputView: NSTextView!
    private var sendButton: NSButton!
    private var audioEngine: AVAudioEngine?
    private var speechRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var micButton: NSButton!
    private var voiceTimer: Timer?
    private var voiceTranscript = ""
    private var voiceSession = 0
    private var pollTimer: Timer?
    private var promptedApprovals = Set<String>()
    private var promptingApproval = false
    private var speakCheckbox: NSButton!
    private let synthesizer = AVSpeechSynthesizer()
    private var spokenCount = 0
    private var pollTick = 0

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildWindow()
        loadConfiguration()
        checkBackend()
    }

    private func buildWindow() {
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 600, height: 690))
        content.translatesAutoresizingMaskIntoConstraints = false

        let title = label("JARVIS", size: 28, bold: true)
        let subtitle = label("Local assistant control center", size: 13, bold: false)
        statusLabel = label("Checking backend…", size: 13, bold: false)
        statusLabel.textColor = .secondaryLabelColor

        backendField = NSTextField(string: "http://127.0.0.1:3002")
        backendField.placeholderString = "Backend URL"
        backendField.toolTip = "Use a loopback URL for a local backend."

        tokenField = NSSecureTextField(string: "")
        tokenField.placeholderString = "JARVIS API token"

        let saveButton = button("Save token", action: #selector(saveToken))
        let healthButton = button("Check backend", action: #selector(checkBackend))
        micButton = button("Voice command", action: #selector(toggleVoice))
        let screenButton = button("Enable screen access", action: #selector(requestScreen))
        let analyzeScreenButton = button("Analyze screen", action: #selector(analyzeScreen))

        commandField = NSTextField(string: "")
        commandField.placeholderString = "Type a command for JARVIS…"
        commandField.target = self
        commandField.action = #selector(sendCommand)
        sendButton = button("Send", action: #selector(sendCommand))

        outputView = NSTextView()
        outputView.isEditable = false
        outputView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        outputView.backgroundColor = .textBackgroundColor
        outputView.string = "JARVIS is ready. Configure the backend token, then send a command."

        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.documentView = outputView

        let configStack = verticalStack([
            label("Backend", size: 12, bold: true),
            backendField,
            label("Authentication", size: 12, bold: true),
            horizontalStack([tokenField, saveButton]),
            horizontalStack([healthButton, micButton, screenButton, analyzeScreenButton]),
        ], spacing: 8)
        let commandStack = horizontalStack([commandField, sendButton])
        speakCheckbox = NSButton(checkboxWithTitle: "Speak replies aloud", target: nil, action: nil)
        speakCheckbox.state = .on
        let mainStack = verticalStack([title, subtitle, statusLabel, separator(), configStack, separator(), commandStack, speakCheckbox, scroll], spacing: 10)
        mainStack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(mainStack)

        NSLayoutConstraint.activate([
            mainStack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 22),
            mainStack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -22),
            mainStack.topAnchor.constraint(equalTo: content.topAnchor, constant: 20),
            mainStack.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -20),
            commandField.heightAnchor.constraint(equalToConstant: 32),
            sendButton.widthAnchor.constraint(equalToConstant: 70),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 300),
        ])

        window = NSWindow(contentRect: content.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "JARVIS"
        window.contentView = content
        window.setContentSize(NSSize(width: 600, height: 690))
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadConfiguration() {
        if let savedURL = UserDefaults.standard.string(forKey: "backendURL"), !savedURL.isEmpty {
            backendField.stringValue = savedURL
        }
        tokenField.stringValue = KeychainStore.read(service: keychainService, account: keychainAccount) ?? ProcessInfo.processInfo.environment["JARVIS_API_TOKEN"] ?? ""
    }

    @objc private func saveToken() {
        let token = tokenField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard token.count >= 32 else {
            showError("Use a token with at least 32 characters.")
            return
        }
        guard let url = URL(string: backendField.stringValue), url.scheme == "http" || url.scheme == "https", url.user == nil else {
            showError("Backend URL must be a valid HTTP(S) URL without embedded credentials.")
            return
        }
        UserDefaults.standard.set(backendField.stringValue, forKey: "backendURL")
        if KeychainStore.save(token, service: keychainService, account: keychainAccount) {
            appendOutput("Saved the API token in macOS Keychain.")
        } else {
            showError("Could not save the token in macOS Keychain.")
        }
    }

    @objc private func checkBackend() {
        guard let base = backendURL() else { return }
        statusLabel.stringValue = "Checking backend…"
        statusLabel.textColor = .secondaryLabelColor
        request(path: "/api/health", method: "GET", body: nil) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let data):
                    self?.statusLabel.stringValue = "Backend connected"
                    self?.statusLabel.textColor = .systemGreen
                    self?.appendOutput("Health: \(data)")
                case .failure(let error):
                    self?.statusLabel.stringValue = "Backend unavailable"
                    self?.statusLabel.textColor = .systemRed
                    self?.appendOutput("Health error: \(error.localizedDescription)")
                }
            }
        }
        _ = base
    }

    @objc private func sendCommand() {
        let goal = commandField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !goal.isEmpty else { return }
        guard tokenField.stringValue.count >= 32 else {
            showError("Configure the JARVIS API token first.")
            return
        }
        sendButton.isEnabled = false
        appendOutput("You: \(goal)")
        let body: [String: Any] = ["goal": goal]
        request(path: "/api/jarvis/tasks/async", method: "POST", body: body) { [weak self] result in
            DispatchQueue.main.async {
                self?.commandField.stringValue = ""
                switch result {
                case .success(let data):
                    guard let id = Self.json(data)?["id"] as? String else {
                        self?.sendButton.isEnabled = true
                        self?.appendOutput("JARVIS error: unexpected response \(data)")
                        return
                    }
                    self?.pollTask(id)
                case .failure(let error):
                    self?.sendButton.isEnabled = true
                    self?.appendOutput("JARVIS error: \(error.localizedDescription)")
                }
            }
        }
    }

    private static func json(_ text: String) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
    }

    private func pollTask(_ id: String) {
        pollTimer?.invalidate()
        spokenCount = 0
        pollTick = 0
        synthesizer.stopSpeaking(at: .immediate)
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
            self?.pollOnce(id)
        }
    }

    private func finishTask(_ message: String) {
        pollTimer?.invalidate()
        pollTimer = nil
        sendButton.isEnabled = true
        appendOutput(message)
    }

    // Speaks each completed sentence once; `final` also speaks the unfinished tail.
    private func speakNewSentences(_ text: String, final: Bool) {
        guard speakCheckbox.state == .on, text.count > spokenCount else { return }
        let pending = String(text.dropFirst(spokenCount))
        var chunk = pending
        if !final {
            let marks = [". ", "! ", "? ", "\n"].compactMap { pending.range(of: $0, options: .backwards)?.upperBound }
            guard let end = marks.max() else { return }
            chunk = String(pending[..<end])
        }
        spokenCount += chunk.count
        let spoken = chunk.trimmingCharacters(in: .whitespacesAndNewlines)
        if !spoken.isEmpty { synthesizer.speak(AVSpeechUtterance(string: String(spoken.prefix(1_000)))) }
    }

    private func pollOnce(_ id: String) {
        pollTick += 1
        if pollTick % 4 == 1 {
            request(path: "/api/jarvis/approvals", method: "GET", body: nil) { [weak self] result in
                guard case .success(let data) = result, let list = Self.json(data)?["approvals"] as? [[String: Any]] else { return }
                DispatchQueue.main.async { self?.promptForApprovals(list) }
            }
        }
        request(path: "/api/jarvis/tasks/\(id)", method: "GET", body: nil) { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.pollTimer != nil else { return }
                switch result {
                case .failure(let error):
                    self.finishTask("JARVIS error: \(error.localizedDescription)")
                case .success(let data):
                    guard let task = Self.json(data), let status = task["status"] as? String else { return }
                    if let partial = task["partial"] as? String { self.speakNewSentences(partial, final: false) }
                    if status == "completed" {
                        let summary = (task["result"] as? [String: Any])?["summary"] as? String ?? data
                        self.finishTask("JARVIS: \(summary)")
                        self.speakNewSentences(summary, final: true)
                    } else if status == "failed" {
                        self.finishTask("JARVIS error: \(task["error"] as? String ?? "task failed")")
                    }
                }
            }
        }
    }

    private func promptForApprovals(_ approvals: [[String: Any]]) {
        guard !promptingApproval else { return }
        guard let item = approvals.first(where: { !promptedApprovals.contains($0["id"] as? String ?? "") }),
              let id = item["id"] as? String else { return }
        promptingApproval = true
        promptedApprovals.insert(id)
        let alert = NSAlert()
        alert.messageText = "Approval required"
        alert.informativeText = "\(item["agentId"] as? String ?? "agent") wants to use \(item["capability"] as? String ?? "a tool"):\n\(item["summary"] as? String ?? "")"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Deny")
        alert.addButton(withTitle: "Approve once")
        let approve = alert.runModal() == .alertSecondButtonReturn
        promptingApproval = false
        request(path: "/api/jarvis/approvals/\(id)", method: "POST", body: ["approve": approve]) { [weak self] result in
            if case .failure(let error) = result {
                DispatchQueue.main.async { self?.appendOutput("Approval error: \(error.localizedDescription)") }
            }
        }
    }

    @objc private func toggleVoice() {
        if audioEngine != nil {
            endVoiceInput()
            return
        }
        SFSpeechRecognizer.requestAuthorization { speechStatus in
            DispatchQueue.main.async { [weak self] in
                guard speechStatus == .authorized else {
                    self?.appendOutput("Speech recognition permission was denied. Enable it in System Settings → Privacy & Security → Speech Recognition.")
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { allowed in
                    DispatchQueue.main.async {
                        guard allowed else {
                            self?.appendOutput("Microphone permission denied. Enable it in System Settings → Privacy & Security → Microphone.")
                            return
                        }
                        self?.startVoiceRecognition()
                    }
                }
            }
        }
    }

    @objc private func requestScreen() {
        let allowed = CGPreflightScreenCaptureAccess()
        if !allowed { _ = CGRequestScreenCaptureAccess() }
        appendOutput(CGPreflightScreenCaptureAccess() ? "Screen access granted." : "Screen access is not granted. Enable it in System Settings → Privacy & Security → Screen Recording.")
    }

    @objc private func analyzeScreen() {
        guard CGPreflightScreenCaptureAccess() else {
            appendOutput("Screen access is required before analysis.")
            return
        }
        Task { @MainActor [weak self] in
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
                guard let display = content.displays.first else { throw AppError.captureUnavailable }
                let filter = SCContentFilter(display: display, excludingWindows: [])
                let configuration = SCStreamConfiguration()
                configuration.width = display.width
                configuration.height = display.height
                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
                self?.sendScreenImage(image)
            } catch {
                self?.appendOutput("Could not capture the screen: \(error.localizedDescription)")
            }
        }
    }

    private func sendScreenImage(_ image: CGImage) {
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.72]) else {
            appendOutput("Could not encode the screen capture.")
            return
        }
        let prompt = commandField.stringValue.isEmpty ? "Describe this screen and explain the most useful next step." : commandField.stringValue
        let body: [String: Any] = ["image": "data:image/jpeg;base64,\(jpeg.base64EncodedString())", "prompt": prompt]
        appendOutput("Sending one explicitly requested screen frame to the configured local model…")
        request(path: "/api/jarvis/screen", method: "POST", body: body) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let data): self?.appendOutput("Screen assistant: \(data)")
                case .failure(let error): self?.appendOutput("Screen analysis error: \(error.localizedDescription)")
                }
            }
        }
    }

    private func startVoiceRecognition() {
        teardownVoice(send: false)
        synthesizer.stopSpeaking(at: .immediate)
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
            appendOutput("Speech recognition is unavailable.")
            return
        }
        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        voiceSession += 1
        let session = voiceSession
        voiceTranscript = ""
        audioEngine = engine
        speechRequest = request
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.voiceSession == session else { return }
                if let result {
                    self.voiceTranscript = result.bestTranscription.formattedString
                    self.commandField.stringValue = self.voiceTranscript
                    self.armVoiceTimer(after: 1.5)
                    if result.isFinal { self.teardownVoice(send: true); return }
                }
                if let error {
                    if self.voiceTranscript.isEmpty {
                        let message = error.localizedDescription
                        self.appendOutput(message.contains("Dictation") ? "Voice needs macOS Dictation. Turn it on in System Settings → Keyboard → Dictation, then try again." : "Voice error: \(message)")
                    }
                    self.teardownVoice(send: !self.voiceTranscript.isEmpty)
                }
            }
        }
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1_024, format: input.outputFormat(forBus: 0)) { [weak request] buffer, _ in request?.append(buffer) }
        do {
            try engine.start()
            micButton.title = "Stop listening"
            statusLabel.stringValue = "Listening… speak, then pause"
            statusLabel.textColor = .systemOrange
            appendOutput("Listening… speak a command, then pause.")
            armVoiceTimer(after: 8)
        } catch {
            appendOutput("Could not start microphone: \(error.localizedDescription)")
            teardownVoice(send: false)
        }
    }

    private func armVoiceTimer(after seconds: TimeInterval) {
        voiceTimer?.invalidate()
        voiceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            guard let self else { return }
            if self.voiceTranscript.isEmpty { self.appendOutput("Didn’t hear anything."); self.teardownVoice(send: false) }
            else { self.endVoiceInput() }
        }
    }

    // Stops the microphone; the recognizer then delivers its final result, which sends the command.
    private func endVoiceInput() {
        voiceTimer?.invalidate()
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        speechRequest?.endAudio()
        audioEngine = nil
        micButton.title = "Voice command"
        statusLabel.stringValue = "Processing speech…"
        armVoiceTimer(after: 4)
    }

    private func teardownVoice(send: Bool) {
        voiceSession += 1
        voiceTimer?.invalidate()
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        speechRequest?.endAudio()
        recognitionTask?.cancel()
        audioEngine = nil
        speechRequest = nil
        recognitionTask = nil
        micButton?.title = "Voice command"
        statusLabel?.stringValue = "Backend connected"
        statusLabel?.textColor = .systemGreen
        let transcript = voiceTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        voiceTranscript = ""
        if send, !transcript.isEmpty {
            commandField.stringValue = transcript
            sendCommand()
        }
    }

    private func backendURL() -> URL? {
        guard let url = URL(string: backendField.stringValue), url.scheme == "http" || url.scheme == "https", url.user == nil else {
            showError("Backend URL must be a valid HTTP(S) URL without embedded credentials.")
            return nil
        }
        return url
    }

    private func request(path: String, method: String, body: [String: Any]?, completion: @escaping (Result<String, Error>) -> Void) {
        guard let base = backendURL(), let url = URL(string: path, relativeTo: base)?.absoluteURL else { return }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !tokenField.stringValue.isEmpty { request.setValue("Bearer \(tokenField.stringValue)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { completion(.failure(error)); return }
            guard let http = response as? HTTPURLResponse, let data else {
                completion(.failure(AppError.invalidResponse)); return
            }
            let text = String(data: data, encoding: .utf8) ?? ""
            guard (200..<300).contains(http.statusCode) else {
                completion(.failure(AppError.server(status: http.statusCode, body: text))); return
            }
            completion(.success(text))
        }.resume()
    }

    private func appendOutput(_ text: String) {
        outputView.string += "\n\n" + text
        outputView.scrollToEndOfDocument(nil)
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "JARVIS"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    private func label(_ text: String, size: CGFloat, bold: Bool) -> NSTextField {
        let field = NSTextField(labelWithString: text)
        field.font = bold ? .boldSystemFont(ofSize: size) : .systemFont(ofSize: size)
        return field
    }

    private func button(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        return button
    }

    private func separator() -> NSBox {
        let box = NSBox()
        box.boxType = .separator
        return box
    }

    private func horizontalStack(_ views: [NSView]) -> NSStackView {
        let stack = NSStackView(views: views)
        stack.orientation = .horizontal
        stack.spacing = 8
        stack.alignment = .centerY
        return stack
    }

    private func verticalStack(_ views: [NSView], spacing: CGFloat) -> NSStackView {
        let stack = NSStackView(views: views)
        stack.orientation = .vertical
        stack.spacing = spacing
        stack.alignment = .leading
        stack.distribution = .fill
        return stack
    }
}

private enum AppError: LocalizedError {
    case invalidResponse
    case captureUnavailable
    case server(status: Int, body: String)
    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "The backend returned an invalid response."
        case .captureUnavailable: return "No shareable display was available."
        case .server(let status, let body): return "Backend returned HTTP \(status): \(body)"
        }
    }
}

private enum KeychainStore {
    static func save(_ value: String, service: String, account: String) -> Bool {
        let data = Data(value.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func read(service: String, account: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
