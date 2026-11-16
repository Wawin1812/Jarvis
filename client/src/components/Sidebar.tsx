import { useState, type ReactNode } from 'react';
import type { AgentJob, OrbState, ServerStatus } from '../types';
import { Icon } from './Icon';
import { Orb } from './Orb';
import { Toggle } from './Toggle';

export interface SidebarProps {
  orb: OrbState;
  statusText: string;
  apiBase: string;
  onApiBase: (value: string) => void;
  token: string;
  onToken: (value: string) => void;
  onConnect: () => void;
  agents: string[];
  activeAgent: string;
  onAgent: (value: string) => void;
  jobs: AgentJob[];
  server: ServerStatus | null;
  notes: string[];
  onForget: (note: string) => void;
  onReindex: () => Promise<string>;
  onRevokeTrust: () => void;
  speakReplies: boolean;
  onSpeakReplies: (value: boolean) => void;
  runInBackground: boolean;
  onRunInBackground: (value: boolean) => void;
  conversation: boolean;
  onConversation: (value: boolean) => void;
  requireWake: boolean;
  onRequireWake: (value: boolean) => void;
  screenSharing: boolean;
  onToggleScreen: () => void;
  onMic: () => void;
}

function Section({ title, icon, children }: { title: string; icon: 'spark' | 'doc' | 'shield' | 'activity'; children: ReactNode }) {
  return (
    <section className="side-section">
      <h3><Icon name={icon} size={14} />{title}</h3>
      {children}
    </section>
  );
}

export function Sidebar(props: SidebarProps) {
  const [indexing, setIndexing] = useState(false);
  const [indexNote, setIndexNote] = useState('');
  const online = props.orb !== 'offline';
  const running = new Set(props.jobs.filter((job) => job.status === 'running' || job.status === 'queued').map((job) => job.agentId));
  const knowledge = props.server?.knowledge;

  async function reindex() {
    setIndexing(true);
    setIndexNote(await props.onReindex());
    setIndexing(false);
  }

  return (
    <aside className="sidebar" aria-label="Controls">
      <div className="brand">
        <Orb state={props.orb} size="sm" />
        <div>
          <div className="brand-name">JARVIS</div>
          <div className={`status ${online ? 'is-online' : ''}`}>{props.statusText}</div>
        </div>
      </div>

      <Section title="Connection" icon="shield">
        <input value={props.apiBase} onChange={(event) => props.onApiBase(event.target.value)} aria-label="Backend URL" placeholder="http://127.0.0.1:3002" spellCheck={false} />
        <input value={props.token} onChange={(event) => props.onToken(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') props.onConnect(); }} aria-label="API token" placeholder="API token (kept in this tab only)" type="password" autoComplete="off" />
        <button type="button" className="btn primary wide" onClick={props.onConnect}>Connect</button>
      </Section>

      <Section title="Agents" icon="spark">
        <ul className="agent-list">
          {props.agents.map((id) => (
            <li key={id}>
              <button type="button" className={`agent ${id === props.activeAgent ? 'is-active' : ''}`} onClick={() => props.onAgent(id)} aria-pressed={id === props.activeAgent}>
                <span className={`pulse ${running.has(id) ? 'is-busy' : ''}`} aria-hidden="true" />
                <span>{id}</span>
                {running.has(id) && <small>working</small>}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Documents" icon="doc">
        {knowledge ? (
          <>
            <p className="muted">{knowledge.files} files · {knowledge.chunks} passages indexed. Ask about them in plain language.</p>
            <button type="button" className="btn wide" onClick={() => void reindex()} disabled={indexing}>
              <Icon name="refresh" size={14} />{indexing ? 'Indexing…' : 'Re-index workspace'}
            </button>
            {indexNote && <p className="muted small" role="status">{indexNote}</p>}
          </>
        ) : (
          <p className="muted">Off. Set <code>JARVIS_KNOWLEDGE=true</code> to search your workspace by meaning.</p>
        )}
      </Section>

      <Section title="Memory" icon="spark">
        {props.notes.length === 0
          ? <p className="muted">Nothing remembered yet. Say “remember that…”.</p>
          : (
            <ul className="notes">
              {props.notes.map((note) => (
                <li key={note}>
                  <span>{note}</span>
                  <button type="button" className="icon-btn tiny" onClick={() => props.onForget(note)} aria-label={`Forget: ${note}`} title="Forget"><Icon name="x" size={12} /></button>
                </li>
              ))}
            </ul>
          )}
      </Section>

      <Section title="Settings" icon="activity">
        <Toggle label="Speak replies" checked={props.speakReplies} onChange={props.onSpeakReplies} />
        <Toggle label="Run in background" hint="Don’t wait for answers" checked={props.runInBackground} onChange={props.onRunInBackground} />
        <Toggle label="Hands-free" hint="Say “goodbye” to stop" checked={props.conversation} onChange={props.onConversation} />
        <Toggle label="Wake word" hint="Only after “Hey Jarvis”" checked={props.requireWake} onChange={props.onRequireWake} />
        <div className="btn-row">
          <button type="button" className="btn" onClick={props.onMic}>Enable mic</button>
          <button type="button" className={`btn ${props.screenSharing ? 'danger' : ''}`} onClick={props.onToggleScreen}>
            <Icon name="screen" size={14} />{props.screenSharing ? 'Stop capture' : 'Capture screen'}
          </button>
        </div>
        {props.server && props.server.trusted.length > 0 && (
          <p className="trust-note">
            Auto-approving {props.server.trusted.join(', ')}.{' '}
            <button type="button" className="link" onClick={props.onRevokeTrust}>Revoke</button>
          </p>
        )}
      </Section>
    </aside>
  );
}
