import { useEffect, useRef, useState } from 'react';

const DEFAULT_API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

type SpeechRecognitionResult = {
  results: ArrayLike<{ 0: { 0: { transcript: string } } }>;
  onresult: ((event: SpeechRecognitionResult) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionResult;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function JarvisPanel() {
  const [apiBase, setApiBase] = useState(DEFAULT_API);
  const [token, setToken] = useState('');
  const [goal, setGoal] = useState('');
  const [status, setStatus] = useState('Not checked');
  const [statusTone, setStatusTone] = useState<'neutral' | 'good' | 'bad'>('neutral');
  const [messages, setMessages] = useState<string[]>(['JARVIS local mode is ready.']);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenBusy, setScreenBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechRecognitionResult | null>(null);

  useEffect(() => () => stopScreenCapture(), []);

  async function checkBackend() {
    try {
      const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/health`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setStatus(`Connected · model ${data.modelConfigured ? 'configured' : 'not configured'}`);
      setStatusTone('good');
    } catch (error) {
      setStatus(`Unavailable · ${error instanceof Error ? error.message : 'connection failed'}`);
      setStatusTone('bad');
    }
  }

  async function sendCommand() {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal || !token.trim()) {
      setMessages((current) => [...current, 'JARVIS: enter a command and API token first.']);
      return;
    }
    setBusy(true);
    setMessages((current) => [...current, `You: ${trimmedGoal}`]);
    try {
      const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/jarvis/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify({ goal: trimmedGoal }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessages((current) => [...current, `JARVIS: ${data.result?.summary || JSON.stringify(data)}`]);
      setGoal('');
    } catch (error) {
      setMessages((current) => [...current, `JARVIS error: ${error instanceof Error ? error.message : 'request failed'}`]);
    } finally {
      setBusy(false);
    }
  }

  async function requestMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMessages((current) => [...current, 'Microphone permission granted. Audio was stopped immediately.']);
    } catch {
      setMessages((current) => [...current, 'Microphone permission was denied or unavailable.']);
    }
  }

  async function toggleScreenCapture() {
    if (screenSharing) {
      stopScreenCapture();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      stream.getVideoTracks()[0].addEventListener('ended', stopScreenCapture);
      setScreenSharing(true);
      setMessages((current) => [...current, 'Screen capture is active and visible below. It will not be sent unless you click Analyze this frame.']);
    } catch {
      setMessages((current) => [...current, 'Screen capture was cancelled or denied.']);
    }
  }

  function stopScreenCapture() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScreenSharing(false);
  }

  async function analyzeVisibleScreen() {
    const video = videoRef.current;
    if (!video || !screenSharing || !token.trim()) {
      setMessages((current) => [...current, 'Start screen capture and configure the API token first.']);
      return;
    }
    if (!video.videoWidth || !video.videoHeight) {
      setMessages((current) => [...current, 'The screen preview is not ready yet.']);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(video.videoWidth, 1920);
    canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/jpeg', 0.72);
    setScreenBusy(true);
    try {
      const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/jarvis/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify({ image, prompt: goal.trim() || 'Describe this screen and explain the most useful next step.' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessages((current) => [...current, `Screen assistant: ${data.answer}`]);
    } catch (error) {
      setMessages((current) => [...current, `Screen analysis error: ${error instanceof Error ? error.message : 'request failed'}`]);
    } finally {
      setScreenBusy(false);
    }
  }

  function toggleSpeech() {
    if (listening) {
      speechRef.current?.stop();
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((current) => [...current, 'Speech recognition is not available in this browser.']);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.onresult = (event) => setGoal(event.results[0][0].transcript);
    recognition.onend = () => { setListening(false); speechRef.current = null; };
    recognition.onerror = () => { setListening(false); speechRef.current = null; };
    speechRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <section className="jarvis-panel">
      <div className="jarvis-heading">
        <div>
          <h2>JARVIS local assistant</h2>
          <p>Visible, permission-based control surface for the local backend.</p>
        </div>
        <span className={`jarvis-status ${statusTone}`}>{status}</span>
      </div>

      <div className="jarvis-config">
        <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} aria-label="JARVIS backend URL" placeholder="http://localhost:3001" />
        <input value={token} onChange={(event) => setToken(event.target.value)} aria-label="JARVIS API token" placeholder="API token (kept in this tab only)" type="password" />
        <button type="button" onClick={checkBackend}>Check backend</button>
      </div>

      <div className="jarvis-command">
        <input value={goal} onChange={(event) => setGoal(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendCommand(); }} placeholder="Tell JARVIS what to do…" aria-label="JARVIS command" disabled={busy} />
        <button type="button" onClick={toggleSpeech} className={listening ? 'permission-btn active' : 'permission-btn'}>{listening ? 'Stop voice' : 'Voice'}</button>
        <button type="button" onClick={() => void sendCommand()} disabled={busy}>{busy ? 'Working…' : 'Send'}</button>
      </div>

      <div className="jarvis-permissions">
        <button type="button" onClick={() => void requestMicrophone()}>Enable microphone</button>
        <button type="button" onClick={() => void toggleScreenCapture()}>{screenSharing ? 'Stop screen capture' : 'Capture screen'}</button>
      </div>

      {screenSharing && <>
        <video className="screen-preview" ref={videoRef} autoPlay muted aria-label="Live screen capture preview" />
        <button type="button" className="analyze-screen-btn" onClick={() => void analyzeVisibleScreen()} disabled={screenBusy}>{screenBusy ? 'Analyzing locally…' : 'Analyze this frame'}</button>
      </>}
      <pre className="jarvis-output" aria-live="polite">{messages.join('\n\n')}</pre>
      <p className="jarvis-note">Screen frames are sent only when you click “Analyze this frame”, and only to the configured backend/model. Microphone audio is not uploaded; browser speech recognition may use the browser’s speech service.</p>
    </section>
  );
}
