import { useEffect, useRef, useState } from 'react';
import { toChat } from './chat';
import { ActivityFeed } from './components/ActivityFeed';
import { ApprovalCard } from './components/ApprovalCard';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { Icon } from './components/Icon';
import { Sidebar } from './components/Sidebar';
import type { AgentJob, OrbState, PendingApproval } from './types';
import { useJarvisData } from './useJarvisData';

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

const SLEEP_PHRASES = /^(goodbye|good bye|that'?s all)\.?$/i;
const STOP_PHRASES = /^(stop listening|stop conversation)\.?$/i;
const STOP_NOW = /^(stop|stop that|stop it|cancel|cancel that|never ?mind|be quiet|shut up|enough)[.!]?$/i;
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
  const [requireWake, setRequireWake] = useState(false);
  const [phase, setPhase] = useState('');
  const [live, setLive] = useState('');
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechRecognitionResult | null>(null);
  const spokenRef = useRef(0);
  const historyRef = useRef<{ user: string; jarvis: string }[]>([]);
  const conversationRef = useRef(false);
  const requireWakeRef = useRef(false);
  const busyRef = useRef(false);
  const heardRef = useRef(false);
  const announcedRef = useRef(new Set<string>());
  const foregroundIdsRef = useRef(new Set<string>());
  const ownedIdsRef = useRef(new Set<string>());
  const seededRef = useRef(false);
  const cancelledRef = useRef(false);
  const awakeUntilRef = useRef(0);
  const speakRef = useRef(true);
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => undefined);

  speakRef.current = speakReplies;
  conversationRef.current = conversation;
  requireWakeRef.current = requireWake;

  const connected = statusTone === 'good';
  const data = useJarvisData(api, connected ? token : '', apiBase);
  const working = jobs.some((job) => job.status === 'running' || job.status === 'queued');
  const orb: OrbState = !connected ? 'offline' : listening ? 'listening' : busy || phase ? 'thinking' : 'idle';

  // Editing the connection details invalidates the current connection until the user connects again.
  function changeToken(value: string) {
    setToken(value);
    setStatusTone('neutral');
    setStatus('Not connected');
  }

  function changeApiBase(value: string) {
    setApiBase(value);
    setStatusTone('neutral');
    setStatus('Not connected');
  }

  useEffect(() => () => stopScreenCapture(), []);

  // Esc stops everything at once.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') void stopAll(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Watch every agent job on the backend (including ones the coordinator starts) and announce finished ones.
  useEffect(() => {
    if (!token.trim()) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await api('/tasks');
        if (!response.ok) return;
        const list: Array<{ id: string; agentId: string; label?: string; goal: string; status: AgentJob['status']; parentId?: string; result?: { summary: string }; error?: string }> = (await response.json()).tasks ?? [];
        const next: AgentJob[] = list.map((task) => ({
          id: task.id, agentId: task.agentId, label: task.label ?? task.goal.slice(0, 60), status: task.status, parentId: task.parentId,
          summary: task.status === 'completed' ? task.result?.summary : task.status === 'failed' ? task.error ?? task.result?.summary : undefined,
        }));
        const firstPoll = !seededRef.current;
        seededRef.current = true;
        for (const job of next) {
          if ((job.status !== 'completed' && job.status !== 'failed') || announcedRef.current.has(job.id)) continue;
          announcedRef.current.add(job.id);
          if (firstPoll || foregroundIdsRef.current.has(job.id) || !isOwned(job)) continue;
          const who = job.parentId ? job.agentId.replace(/-/g, ' ') : 'Your background task';
          const verb = job.status === 'completed' ? 'finished' : 'failed';
          setMessages((current) => [...current, `${job.parentId ? job.agentId : 'Background task'} ${verb} (${job.label}): ${job.summary ?? ''}`]);
          speakNow(`${who} ${verb}. ${job.summary ?? ''}`);
        }
        setJobs(next.filter((job) => !foregroundIdsRef.current.has(job.id) && isOwned(job)).slice(-8).reverse());
        if (!busyRef.current && next.some((job) => job.status === 'running')) {
          const approvalResponse = await api('/approvals');
          if (approvalResponse.ok) setApprovals((await approvalResponse.json()).approvals ?? []);
        }
      } catch {
        // Transient polling errors are retried on the next tick.
      }
    }, 1500);
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
        if (info.status === 401) {
          setStatus('Token rejected');
          setStatusTone('bad');
          return;
        }
        if (info.ok) setAgents((await info.json()).agents ?? ['coordinator']);
      }
    } catch (error) {
      setStatus(`Unavailable · ${error instanceof Error ? error.message : 'connection failed'}`);
      setStatusTone('bad');
    }
  }

  // Another client (or script) may share this backend; only jobs started from here, or spawned by them, are announced.
  function isOwned(job: { id: string; parentId?: string }) {
    return ownedIdsRef.current.has(job.id) || Boolean(job.parentId && ownedIdsRef.current.has(job.parentId));
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
    // Never listen while speaking: the mic would pick up JARVIS's own voice.
    speechRef.current?.stop();
    utterance.onend = () => { onDone?.(); if (onDone !== resumeListening) setTimeout(resumeListening, 350); };
    utterance.onerror = utterance.onend;
    window.speechSynthesis.speak(utterance);
  }

  // Speaks each completed sentence once; `final` also speaks the unfinished tail and then re-opens the mic.
  function speakNewSentences(text: string, final: boolean) {
    const pending = text.slice(spokenRef.current);
    const ends = ['. ', '! ', '? ', '\n'].map((mark) => (pending.lastIndexOf(mark) < 0 ? 0 : pending.lastIndexOf(mark) + mark.length));
    let end = Math.max(...ends);
    // Start talking after the first clause instead of waiting for a full sentence.
    if (end === 0 && spokenRef.current === 0) {
      const comma = Math.max(pending.lastIndexOf(', '), pending.lastIndexOf('; '));
      if (comma >= 24) end = comma + 2;
    }
    const complete = final ? pending : pending.slice(0, end);
    spokenRef.current += complete.length;
    if (final) speakNow(complete, resumeListening);
    else speakNow(complete);
  }

  function resumeListening(allowBusy = false) {
    if (conversationRef.current && (allowBusy === true || !busyRef.current) && !speechRef.current && !window.speechSynthesis?.speaking) startListening();
  }

  // Silence JARVIS and cancel every running task right now; the UI resets before the server even answers.
  async function stopAll() {
    cancelledRef.current = true;
    window.speechSynthesis?.cancel();
    setApprovals([]);
    setLive('');
    setPhase('');
    if (busyRef.current || jobs.some((job) => job.status === 'running' || job.status === 'queued')) {
      setMessages((current) => [...current, 'JARVIS: stopped.']);
    }
    if (!token.trim()) return;
    try {
      await api('/cancel', { method: 'POST' });
    } catch {
      // The backend may be unreachable; local state is already reset.
    }
  }

  async function sendCommand(text?: string) {
    const raw = (text ?? goal).trim();
    if (!raw || !token.trim()) {
      setMessages((current) => [...current, 'JARVIS: enter a command and API token first.']);
      return;
    }
    if (STOP_NOW.test(raw)) {
      setGoal('');
      await stopAll();
      return;
    }
    if (busyRef.current) return;
    if (SLEEP_PHRASES.test(raw)) {
      if (!requireWakeRef.current) {
        setConversation(false);
        conversationRef.current = false;
        setMessages((current) => [...current, 'JARVIS: hands-free mode off.']);
        speakNow('Goodbye.');
        setGoal('');
        return;
      }
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
        const response = await api('/tasks/async', { method: 'POST', body: JSON.stringify({ goal: withHistory(request), agentId: agent, background: true }) });
        const task = await response.json();
        if (!response.ok) throw new Error(task.error || `HTTP ${response.status}`);
        ownedIdsRef.current.add(task.id);
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
    cancelledRef.current = false;
    setPhase('Thinking…');
    setLive('');
    spokenRef.current = 0;
    // Keep the mic open while thinking so a spoken "stop" works; speech output closes it again.
    if (conversationRef.current) setTimeout(() => resumeListening(true), 500);
    let spokeAnswer = false;
    try {
      const response = await api('/tasks/async', { method: 'POST', body: JSON.stringify({ goal: withHistory(request), agentId: agent }) });
      let task = await response.json();
      if (!response.ok) throw new Error(task.error || `HTTP ${response.status}`);
      foregroundIdsRef.current.add(task.id);
      ownedIdsRef.current.add(task.id);
      if (cancelledRef.current) {
        await api(`/tasks/${task.id}/cancel`, { method: 'POST' });
        return;
      }
      let tick = 0;
      while (task.status === 'queued' || task.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (cancelledRef.current) return;
        const taskResponse = await api(`/tasks/${task.id}`);
        if (!taskResponse.ok) throw new Error(`HTTP ${taskResponse.status}`);
        task = await taskResponse.json();
        if (cancelledRef.current) return;
        if (typeof task.partial === 'string' && task.partial) {
          setLive(task.partial);
          setPhase('');
          speakNewSentences(task.partial, false);
        }
        if (tick++ % 6 === 0) {
          const approvalResponse = await api('/approvals');
          const pending = approvalResponse.ok ? (await approvalResponse.json()).approvals ?? [] : [];
          setApprovals(pending);
          if (pending.length) setPhase('Waiting for your approval…');
        }
      }
      setApprovals([]);
      if (task.status === 'cancelled') return;
      if (task.status === 'failed') throw new Error(task.error || 'Task failed.');
      const answer: string = task.result?.summary || JSON.stringify(task);
      setMessages((current) => [...current, `${agent}: ${answer}`]);
      historyRef.current = [...historyRef.current, { user: request, jarvis: answer }].slice(-3);
      speakNewSentences(answer, true);
      spokeAnswer = true;
      awakeUntilRef.current = Date.now() + 30_000;
      setGoal('');
    } catch (error) {
      if (cancelledRef.current) return;
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
    // A spoken stop always works, awake or not.
    if (STOP_NOW.test(transcript.trim())) {
      void sendRef.current(transcript);
      return;
    }
    if (busyRef.current) {
      setTimeout(() => resumeListening(true), 300);
      return;
    }
    if (!conversationRef.current) {
      setGoal(transcript);
      void sendRef.current(transcript);
      return;
    }
    const wake = WAKE_PHRASE.exec(transcript);
    // Without the wake-word requirement every utterance is a command (a leading "Jarvis" is dropped).
    const spoken = (wake ? transcript.slice(wake[0].length) : transcript).trim();
    if (!requireWakeRef.current && spoken.length >= 4) {
      setGoal(spoken);
      void sendRef.current(spoken);
      return;
    }
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
    } else if (Date.now() < awakeUntilRef.current && transcript.trim().split(/\s+/).length >= 2) {
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
      if (conversationRef.current && !heardRef.current) setTimeout(() => resumeListening(true), 300);
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

  const statusText = connected ? `Online · ${data.server?.model?.name ?? 'ready'}` : status;
  const tools = data.server?.tools ?? [];

  return (
    <div className="hud">
      <Sidebar
        orb={orb}
        statusText={statusText}
        apiBase={apiBase}
        onApiBase={changeApiBase}
        token={token}
        onToken={changeToken}
        onConnect={() => void checkBackend()}
        agents={agents}
        activeAgent={agent}
        onAgent={setAgent}
        jobs={jobs}
        server={data.server}
        notes={data.notes}
        onForget={(note) => void data.forget(note)}
        onReindex={data.reindex}
        onRevokeTrust={() => void data.revokeTrust()}
        speakReplies={speakReplies}
        onSpeakReplies={(value) => { setSpeakReplies(value); if (!value) window.speechSynthesis?.cancel(); }}
        runInBackground={runInBackground}
        onRunInBackground={setRunInBackground}
        conversation={conversation}
        onConversation={toggleConversation}
        requireWake={requireWake}
        onRequireWake={setRequireWake}
        screenSharing={screenSharing}
        onToggleScreen={() => void toggleScreenCapture()}
        onMic={() => void requestMicrophone()}
      />

      <main className="stage">
        <header className="topbar">
          <h1>Conversation</h1>
          <div className="pills">
            {data.server?.model && <span className="pill ok">{data.server.model.name}</span>}
            {tools.map((tool) => <span key={tool} className="pill">{tool}</span>)}
            {data.server?.persistentAudit && <span className="pill">audit encrypted</span>}
            <span className="pill">local only</span>
          </div>
        </header>

        <ChatThread
          messages={toChat(messages)}
          live={live}
          liveSpeaker={agent}
          phase={phase}
          orb={orb}
          onSuggest={(text) => { setGoal(text); }}
        />

        <div className="dock">
          {approvals.map((item) => (
            <ApprovalCard key={item.id} item={item} trustable={TRUSTABLE.includes(item.capability)} onDecide={(id, approve, remember) => void decide(id, approve, remember)} />
          ))}
          <div className="screen-box" hidden={!screenSharing}>
            <video ref={videoRef} autoPlay muted aria-label="Live screen capture preview" />
            <button type="button" className="btn primary" onClick={() => void analyzeVisibleScreen()} disabled={screenBusy}>
              <Icon name="screen" size={15} />{screenBusy ? 'Analysing locally…' : 'Analyse this frame'}
            </button>
            <p className="muted small">Sent only when you click, and only to your local model.</p>
          </div>
        </div>

        <Composer
          goal={goal}
          onGoal={setGoal}
          onSend={() => void sendCommand()}
          onStop={() => void stopAll()}
          onVoice={toggleSpeech}
          busy={busy}
          working={working}
          listening={listening}
          ready={connected}
          agent={agent}
          agents={agents}
          onAgent={setAgent}
        />
      </main>

      <aside className="rail" aria-label="Activity">
        <div className="panel-head">
          <span>Activity</span>
          {(busy || working) && <span className="live-dot">live</span>}
        </div>
        <ActivityFeed events={data.events} />
      </aside>
    </div>
  );
}
