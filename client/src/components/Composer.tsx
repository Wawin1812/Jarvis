import { Icon } from './Icon';

export function Composer({ goal, onGoal, onSend, onStop, onVoice, busy, working, listening, ready, agent, agents, onAgent }: {
  goal: string;
  onGoal: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onVoice: () => void;
  busy: boolean;
  /** True while any agent job (including background ones) is running. */
  working: boolean;
  listening: boolean;
  ready: boolean;
  agent: string;
  agents: string[];
  onAgent: (value: string) => void;
}) {
  return (
    <form className="composer" onSubmit={(event) => { event.preventDefault(); onSend(); }}>
      <label className="agent-pick">
        <span className="visually-hidden">Agent</span>
        <select value={agent} onChange={(event) => onAgent(event.target.value)} disabled={busy}>
          {agents.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <input
        value={goal}
        onChange={(event) => onGoal(event.target.value)}
        placeholder={ready ? 'Ask JARVIS anything…' : 'Add your API token in the sidebar and press Connect'}
        aria-label="Message JARVIS"
        disabled={busy}
        autoComplete="off"
      />
      <button type="button" className={`icon-btn ${listening ? 'is-live' : ''}`} onClick={onVoice} aria-label={listening ? 'Stop listening' : 'Speak'} aria-pressed={listening} title={listening ? 'Stop listening' : 'Speak'}>
        <Icon name="mic" />
      </button>
      {busy || working
        ? <button type="button" className="icon-btn danger" onClick={onStop} aria-label="Stop everything" title="Stop everything (Esc)"><Icon name="stop" /></button>
        : null}
      <button type="submit" className="send-btn" disabled={busy || !goal.trim()} aria-label="Send">
        <Icon name="send" /><span>Send</span>
      </button>
    </form>
  );
}
