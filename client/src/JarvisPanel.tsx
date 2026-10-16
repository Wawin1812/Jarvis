import { useEffect, useRef, useState } from 'react';

const DEFAULT_API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3002';

type SpeechRecognitionEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };

type SpeechRecognitionResult = {
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
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

type PendingApproval = { id: string; agentId: string; capability: string; summary: string };
type BackgroundTask = { id: string; label: string; status: 'running' | 'completed' | 'failed'; summary?: string };

const SLEEP_PHRASES = /^(goodbye|good bye|that'?s all)\.?$/i;
const STOP_PHRASES = /^(stop listening|stop conversation)\.?$/i;
const WAKE_PHRASE = /^(?:(?:hey|hi|okay|ok)[,\s]+)?jarvis\b[,.!?\s]*/i;
const TRUSTABLE = ['files.read', 'browser.read'];

// "in the background, do X" / "do X in the background" -> background task.
function splitBackground(text: string): { goal: string; background: boolean } {
  const lead = /^(?:please\s+)?(?:in the background|background)[,:]?\s+/i;
  const tail = /[,\s]+in the background\.?$/i;
  if (lead.test(text)) return { goal: text.replace(lead, ''), background: true };
  if (tail.test(text)) return { goal: text.replace(tail, ''), background: true };
  return { goal: text, background: false };
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
  const [agent, setAgent] = useState('coordinator');
  const [agents, setAgents] = useState<string[]>(['coordinator']);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [runInBackground, setRunInBackground] = useState(false);
  const [conversation, setConversation] = useState(false);
  const [phase, setPhase] = useState('');
  const [live, setLive] = useState('');
  const [bgTasks, setBgTasks] = useState<BackgroundTask[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechRecognitionResult | null>(null);
  const spokenRef = useRef(0);
  const historyRef = useRef<{ user: string; jarvis: string }[]>([]);
  const conversationRef = useRef(false);
  const busyRef = useRef(false);
  const heardRef = useRef(false);
  const awakeUntilRef = useRef(0);
  const speakRef = useRef(true);
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => undefined);

  speakRef.current = speakReplies;
  conversationRef.current = conversation;

  useEffect(() => () => stopScreenCapture(), []);

  // Poll background tasks (and any approval they need) while some are still running.
  const hasRunning = bgTasks.some((task) => task.status === 'running');
  useEffect(() => {
    if (!hasRunning || !token.trim()) return undefined;
    const timer = setInterval(async () => {
      try {
        const running = bgTasks.filter((task) => task.status === 'running');
        const updates = await Promise.all(running.map(async (task) => {
          const response = await api(`/tasks/${task.id}`);
          return response.ok ? { id: task.id, data: await response.json() } : null;
        }));
        const finished: BackgroundTask[] = [];
        for (const entry of updates) {
          if (!entry || (entry.data.status !== 'completed' && entry.data.status !== 'failed')) continue;
          const task = running.find((item) => item.id === entry.id) as BackgroundTask;
          finished.push({
            ...task,
            status: entry.data.status,
            summary: entry.data.status === 'completed' ? entry.data.result?.summary ?? 'Done.' : entry.data.error ?? 'Task failed.',
          });
        }
        if (finished.length) {
          setBgTasks((current) => current.map((task) => finished.find((done) => done.id === task.id) ?? task));
          finished.forEach((task) => {
            setMessages((current) => [...current, `Background task ${task.status === 'completed' ? 'finished' : 'failed'} (${task.label}): ${task.summary}`]);
            speakNow(task.status === 'completed' ? `Your background task is done. ${task.summary}` : `A background task failed. ${task.summary}`);
          });
        }
        if (!busyRef.current) {
          const response = await api('/approvals');
          if (response.ok) setApprovals((await response.json()).approvals ?? []);
        }
      } catch {
        // Transient polling errors are retried on the next tick.
      }
    }, 1000);
    return () => clearInterval(timer);
  });

  async function checkBackend() {
    try {
      const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/health`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setStatus(`Connected · model ${data.modelConfigured ? 'configured' : 'not configured'}`);
      setStatusTone('good');
      if (token.trim()) {
        const info = await api('/status');
        if (info.ok) setAgents((await info.json()).agents ?? ['coordinator']);
      }
    } catch (error) {
      setStatus(`Unavailable · ${error instanceof Error ? error.message : 'connection failed'}`);
      setStatusTone('bad');
    }
  }

  function api(path: string, init: RequestInit = {}) {
    return fetch(`${apiBase.replace(/\/$/, '')}/api/jarvis${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
    });
  }

  async function decide(id: string, approve: boolean, remember = false) {
    setApprovals((current) => current.filter((item) => item.id !== id));
    await api(`/approvals/${id}`, { method: 'POST', body: JSON.stringify({ approve, remember }) });
  }

  function withHistory(request: string) {
    const past = historyRef.current.map((turn) => `User: ${turn.user}\nJARVIS: ${turn.jarvis}`).join('\n').slice(-2_500);
    return past ? `Earlier in this conversation:\n${past}\n\nNew request: ${request}` : request;
  }

  // Queues speech after anything already playing; `onDone` fires when it ends (or immediately if nothing is spoken).
  function speakNow(text: string, onDone?: () => void) {
    if (!speakRef.current || !('speechSynthesis' in window) || !text.trim()) {
      onDone?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text.trim().slice(0, 1_000));
    if (onDone) {
      utterance.onend = onDone;
      utterance.onerror = onDone;
    }
    window.speechSynthesis.speak(utterance);
  }

  // Speaks each completed sentence once; `final` also speaks the unfinished tail and then re-opens the mic.
  function speakNewSentences(text: string, final: boolean) {
    const pending = text.slice(spokenRef.current);
    const ends = ['. ', '! ', '? ', '\n'].map((mark) => (pending.lastIndexOf(mark) < 0 ? 0 : pending.lastIndexOf(mark) + mark.length));
    const complete = final ? pending : pending.slice(0, Math.max(...ends));
    spokenRef.current += complete.length;
    if (final) speakNow(complete, resumeListening);
    else speakNow(complete);
  }

  function resumeListening() {
    if (conversationRef.current && !busyRef.current && !speechRef.current) startListening();
  }

  async function sendCommand(text?: string) {
    const raw = (text ?? goal).trim();
    if (!raw || !token.trim()) {
      setMessages((current) => [...current, 'JARVIS: enter a command and API token first.']);
      return;
    }
    if (SLEEP_PHRASES.test(raw)) {
      awakeUntilRef.current = 0;
      setMessages((current) => [...current, 'JARVIS: going back to sleep. Say “Hey Jarvis” to wake me.']);
      speakNow('Goodbye. Say hey Jarvis when you need me.', resumeListening);
      setGoal('');
      return;
    }
    if (STOP_PHRASES.test(raw)) {
      setConversation(false);
      conversationRef.current = false;
      setMessages((current) => [...current, 'JARVIS: hands-free mode off.']);
      speakNow('Okay, I will stop listening.');
      setGoal('');
      return;
    }
    const parsed = splitBackground(raw);
    const background = runInBackground || parsed.background;
    const request = parsed.goal;
    setMessages((current) => [...current, `You: ${raw}`]);
    window.speechSynthesis?.cancel();

    if (background) {
      try {
        const response = await api('/tasks/async', { method: 'POST', body: JSON.stringify({ goal: withHistory(request), agentId: agent }) });
        const task = await response.json();
        if (!response.ok) throw new Error(task.error || `HTTP ${response.status}`);
        setBgTasks((current) => [{ id: task.id, label: request.slice(0, 60), status: 'running' as const }, ...current].slice(0, 10));
        setMessages((current) => [...current, 'JARVIS: on it, working in the background.']);
        setGoal('');
        speakNow('On it. I will tell you when it is done.', resumeListening);
      } catch (error) {
        setMessages((current) => [...current, `JARVIS error: ${error instanceof Error ? error.message : 'request failed'}`]);
        resumeListening();
      }
      return;
    }

    setBusy(true);
    busyRef.current = true;
    setPhase('Thinking…');
    setLive('');
    spokenRef.current = 0;
    let spokeAnswer = false;
    try {
      const response = await api('/tasks/async', { method: 'POST', body: JSON.stringify({ goal: withHistory(request), agentId: agent }) });
      let task = await response.json();
      if (!response.ok) throw new Error(task.error || `HTTP ${response.status}`);
      let tick = 0;
      while (task.status === 'queued' || task.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const taskResponse = await api(`/tasks/${task.id}`);
        if (!taskResponse.ok) throw new Error(`HTTP ${taskResponse.status}`);
        task = await taskResponse.json();
        if (typeof task.partial === 'string' && task.partial) {
          setLive(task.partial);
          setPhase('');
          speakNewSentences(task.partial, false);
        }
        if (tick++ % 4 === 0) {
          const approvalResponse = await api('/approvals');
          const pending = approvalResponse.ok ? (await approvalResponse.json()).approvals ?? [] : [];
          setApprovals(pending);
          if (pending.length) setPhase('Waiting for your approval…');
        }
      }
      setApprovals([]);
      if (task.status === 'failed') throw new Error(task.error || 'Task failed.');
      const answer: string = task.result?.summary || JSON.stringify(task);
      setMessages((current) => [...current, `${agent}: ${answer}`]);
      historyRef.current = [...historyRef.current, { user: request, jarvis: answer }].slice(-3);
      speakNewSentences(answer, true);
      spokeAnswer = true;
      awakeUntilRef.current = Date.now() + 30_000;
      setGoal('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request failed';
      setMessages((current) => [...current, `JARVIS error: ${message}`]);
      speakNow(`Sorry, something went wrong. ${message}`, resumeListening);
      spokeAnswer = true;
    } finally {
      setBusy(false);
      busyRef.current = false;
      setPhase('');
      setLive('');
      if (!spokeAnswer) resumeListening();
    }
  }
  sendRef.current = sendCommand;

  // Hands-free: act on "Hey Jarvis …" or, for 30 s after the last exchange, on any follow-up; otherwise stay asleep.
  function handleHeard(transcript: string) {
    if (!conversationRef.current) {
      setGoal(transcript);
      void sendRef.current(transcript);
      return;
    }
    const wake = WAKE_PHRASE.exec(transcript);
    if (wake) {
      const rest = transcript.slice(wake[0].length).trim();
      awakeUntilRef.current = Date.now() + 30_000;
      if (rest) {
        setGoal(rest);
        void sendRef.current(rest);
      } else {
        setMessages((current) => [...current, 'JARVIS: yes?']);
        speakNow('Yes?', resumeListening);
      }
    } else if (Date.now() < awakeUntilRef.current) {
      setGoal(transcript);
      void sendRef.current(transcript);
    } else {
      setTimeout(resumeListening, 300);
    }
  }

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessages((current) => [...current, 'Speech recognition is not available in this browser.']);
      setConversation(false);
      return;
    }
    const recognition = new SpeechRecognition();
    heardRef.current = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      heardRef.current = true;
      handleHeard(transcript);
    };
    recognition.onend = () => {
      setListening(false);
      speechRef.current = null;
      // In conversation mode keep the mic open if nothing was said.
      if (conversationRef.current && !heardRef.current && !busyRef.current) setTimeout(resumeListening, 300);
    };
    recognition.onerror = (event) => {
      setListening(false);
      speechRef.current = null;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setConversation(false);
        conversationRef.current = false;
        setMessages((current) => [...current, 'Microphone or speech service was blocked, so voice is off.']);
      }
    };
    speechRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function toggleSpeech() {
    if (listening) {
      speechRef.current?.stop();
      return;
    }
    window.speechSynthesis?.cancel();
    startListening();
  }

  function toggleConversation(enabled: boolean) {
    setConversation(enabled);
    conversationRef.current = enabled;
    if (enabled && !listening && !busyRef.current) {
      window.speechSynthesis?.cancel();
      startListening();
    }
    if (!enabled) speechRef.current?.stop();
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
      speakNow(data.answer);
    } catch (error) {
      setMessages((current) => [...current, `Screen analysis error: ${error instanceof Error ? error.message : 'request failed'}`]);
    } finally {
      setScreenBusy(false);
    }
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
        <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} aria-label="JARVIS backend URL" placeholder="http://127.0.0.1:3002" />
        <input value={token} onChange={(event) => setToken(event.target.value)} aria-label="JARVIS API token" placeholder="API token (kept in this tab only)" type="password" />
        <button type="button" onClick={checkBackend}>Check backend</button>
      </div>

      <div className="jarvis-command">
        <select value={agent} onChange={(event) => setAgent(event.target.value)} aria-label="Agent" disabled={busy}>
          {agents.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <input value={goal} onChange={(event) => setGoal(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void sendCommand(); }} placeholder="Tell JARVIS what to do…" aria-label="JARVIS command" disabled={busy} />
        <button type="button" onClick={toggleSpeech} className={listening ? 'permission-btn active' : 'permission-btn'}>{listening ? 'Stop voice' : 'Voice'}</button>
        <button type="button" onClick={() => void sendCommand()} disabled={busy}>{busy ? 'Working…' : 'Send'}</button>
      </div>
      {phase && <p className="jarvis-note" role="status">{phase}</p>}
      <div className="jarvis-toggles">
        <label className="jarvis-note">
          <input type="checkbox" checked={speakReplies} onChange={(event) => { setSpeakReplies(event.target.checked); if (!event.target.checked) window.speechSynthesis?.cancel(); }} /> Speak replies aloud
        </label>
        <label className="jarvis-note">
          <input type="checkbox" checked={runInBackground} onChange={(event) => setRunInBackground(event.target.checked)} /> Run tasks in the background
        </label>
        <label className="jarvis-note">
          <input type="checkbox" checked={conversation} onChange={(event) => toggleConversation(event.target.checked)} /> Hands-free (say “Hey Jarvis” to wake, “goodbye” to sleep)
        </label>
      </div>

      <div className="jarvis-permissions">
        <button type="button" onClick={() => void requestMicrophone()}>Enable microphone</button>
        <button type="button" onClick={() => void toggleScreenCapture()}>{screenSharing ? 'Stop screen capture' : 'Capture screen'}</button>
      </div>

      {screenSharing && <>
        <video className="screen-preview" ref={videoRef} autoPlay muted aria-label="Live screen capture preview" />
        <button type="button" className="analyze-screen-btn" onClick={() => void analyzeVisibleScreen()} disabled={screenBusy}>{screenBusy ? 'Analyzing locally…' : 'Analyze this frame'}</button>
      </>}
      {approvals.map((item) => (
        <div key={item.id} className="approval-card" role="alertdialog" aria-label="Approval required">
          <div><strong>{item.agentId}</strong> wants to use <code>{item.capability}</code></div>
          <code className="approval-input">{item.summary}</code>
          <div className="approval-actions">
            <button type="button" onClick={() => void decide(item.id, true)}>Approve once</button>
            {TRUSTABLE.includes(item.capability) && <button type="button" onClick={() => void decide(item.id, true, true)}>Allow for 30 min</button>}
            <button type="button" className="deny" onClick={() => void decide(item.id, false)}>Deny</button>
          </div>
        </div>
      ))}
      {bgTasks.length > 0 && (
        <ul className="jarvis-tasks" aria-label="Background tasks">
          {bgTasks.map((task) => (
            <li key={task.id}><strong>{task.status === 'running' ? 'Running' : task.status === 'completed' ? 'Done' : 'Failed'}</strong> · {task.label}{task.summary ? ` — ${task.summary.slice(0, 120)}` : ''}</li>
          ))}
        </ul>
      )}
      <pre className="jarvis-output" aria-live="polite">{[...messages, ...(live ? [`${agent}: ${live}…`] : [])].join('\n\n')}</pre>
      <p className="jarvis-note">Screen frames are sent only when you click “Analyze this frame”, and only to the configured backend/model. Microphone audio is not uploaded; browser speech recognition may use the browser’s speech service.</p>
    </section>
  );
}
