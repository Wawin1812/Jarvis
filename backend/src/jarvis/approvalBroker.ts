import type { JarvisAgentId, JarvisApproval } from './contracts.js';
import type { JarvisCapability } from '../services/jarvisPolicy.js';

export interface JarvisPendingApproval {
  id: string;
  taskId: string;
  agentId: JarvisAgentId;
  capability: JarvisCapability;
  summary: string;
  createdAt: string;
  expiresAt: string;
}

interface Waiter extends JarvisPendingApproval {
  resolve: (approval: JarvisApproval | null) => void;
  timer: NodeJS.Timeout;
}

/** Only a human decision through `decide` can mint an approval; agents never create their own. */
export class JarvisApprovalBroker {
  private readonly waiting = new Map<string, Waiter>();

  constructor(
    private readonly requestTimeoutMs = 120_000,
    private readonly grantTtlMs = 60_000,
    private readonly maxPending = 20,
  ) {}

  request(info: Pick<JarvisPendingApproval, 'taskId' | 'agentId' | 'capability' | 'summary'>): Promise<JarvisApproval | null> {
    if (this.waiting.size >= this.maxPending) return Promise.resolve(null);
    const id = crypto.randomUUID();
    const now = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(id, null), this.requestTimeoutMs);
      timer.unref();
      this.waiting.set(id, {
        ...info,
        id,
        summary: info.summary.slice(0, 300),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.requestTimeoutMs).toISOString(),
        resolve,
        timer,
      });
    });
  }

  list(): JarvisPendingApproval[] {
    return [...this.waiting.values()].map(({ resolve: _resolve, timer: _timer, ...pending }) => pending);
  }

  decide(id: string, approve: boolean): boolean {
    const waiter = this.waiting.get(id);
    if (!waiter) return false;
    this.settle(id, approve ? {
      id: crypto.randomUUID(),
      capability: waiter.capability,
      expiresAt: new Date(Date.now() + this.grantTtlMs).toISOString(),
    } : null);
    return true;
  }

  private settle(id: string, approval: JarvisApproval | null): void {
    const waiter = this.waiting.get(id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.waiting.delete(id);
    waiter.resolve(approval);
  }
}
