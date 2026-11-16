import { capabilityLabel } from '../chat';
import type { AuditEvent } from '../types';

type Tone = 'info' | 'ok' | 'warn' | 'bad';

function describe(event: AuditEvent): { title: string; tone: Tone } {
  const what = capabilityLabel(event.capability);
  switch (event.type) {
    case 'task.created': return { title: 'Task started', tone: 'info' };
    case 'task.completed': return { title: 'Task completed', tone: 'ok' };
    case 'task.failed': return { title: 'Task failed', tone: 'bad' };
    case 'tool.requested': return { title: `Wants to: ${what.toLowerCase()}`, tone: 'info' };
    case 'approval.requested': return { title: `Waiting for you: ${what.toLowerCase()}`, tone: 'warn' };
    case 'tool.allowed': return { title: `Allowed: ${what.toLowerCase()}`, tone: 'ok' };
    case 'tool.denied': return { title: `Blocked: ${what.toLowerCase()}`, tone: 'bad' };
    case 'knowledge.indexed': return { title: 'Documents indexed', tone: 'ok' };
    case 'screen.analyzed': return { title: 'Screen frame analysed', tone: 'info' };
    default: return { title: event.type, tone: 'info' };
  }
}

export function ActivityFeed({ events }: { events: AuditEvent[] }) {
  const rows = [...events].reverse();
  return (
    <ol className="feed" aria-label="Activity timeline">
      {rows.length === 0 && <li className="feed-empty">Nothing yet. Actions and approvals will appear here as they happen.</li>}
      {rows.map((event) => {
        const { title, tone } = describe(event);
        return (
          <li key={event.id} className={`feed-item tone-${tone}`}>
            <span className="feed-dot" aria-hidden="true" />
            <div>
              <div className="feed-title">{title}</div>
              <div className="feed-meta">
                <time dateTime={event.at}>{new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                {event.agentId && <span className="tag">{event.agentId}</span>}
              </div>
              {(event.type === 'tool.denied' || event.type === 'task.failed' || event.type === 'knowledge.indexed') && <div className="feed-detail">{event.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
