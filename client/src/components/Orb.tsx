import type { OrbState } from '../types';

const LABEL: Record<OrbState, string> = {
  idle: 'ready',
  listening: 'listening',
  thinking: 'thinking',
  offline: 'offline',
};

export function Orb({ state, size = 'md' }: { state: OrbState; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`orb orb-${state} orb-${size}`} role="img" aria-label={`JARVIS is ${LABEL[state]}`}>
      <span className="orb-ring orb-ring-a" />
      <span className="orb-ring orb-ring-b" />
      <span className="orb-arc" />
      <span className="orb-core" />
    </div>
  );
}
