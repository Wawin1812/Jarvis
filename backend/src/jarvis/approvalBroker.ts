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

/** Only read-only capabilities can be trusted, and file reads and web reads are never trusted together. */
const TRUSTABLE: ReadonlySet<JarvisCapability> = new Set(['files.read', 'browser.read']);

/** Only a human decision through `decide` can mint an approval; agents never create their own. */
export class JarvisApprovalBroker {
  private readonly waiting = new Map<string, Waiter>();
  private readonly trusted = new Map<JarvisCapability, number>();

  constructor(
    private readonly requestTimeoutMs = 120_000,
    private readonly grantTtlMs = 60_000,
    private readonly maxPending = 20,
    private readonly trustTtlMs = 30 * 60_000,
  ) {}

  /** Skips prompts for `capability` until the trust expires. Returns false if it is not trustable. */
  trust(capability: JarvisCapability, ms = this.trustTtlMs): boolean {
    if (!TRUSTABLE.has(capability)) return false;
    for (const other of TRUSTABLE) if (other !== capability) this.trusted.delete(other);
    this.trusted.set(capability, Date.now() + ms);
    return true;
  }

  revokeTrust(): void {
    this.trusted.clear();
  }

  trustedCapabilities(): JarvisCapability[] {
    const now = Date.now();
    return [...this.trusted].filter(([, until]) => until > now).map(([capability]) => capability);
  }

  grantIfTrusted(capability: JarvisCapability): JarvisApproval | null {
    const until = this.trusted.get(capability);
    if (!until || until <= Date.now()) return null;
    return { id: crypto.randomUUID(), capability, expiresAt: new Date(Date.now() + this.grantTtlMs).toISOString() };
  }

  request(info: Pick<JarvisPendingApproval, 'taskId' | 'agentId' | 'capability' | 'summary'>, signal?: AbortSignal): Promise<JarvisApproval | null> {
    if (signal?.aborted || this.waiting.size >= this.maxPending) return Promise.resolve(null);
    const id = crypto.randomUUID();
    const now = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(id, null), this.requestTimeoutMs);
      timer.unref();
      signal?.addEventListener('abort', () => this.settle(id, null), { once: true });
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

  decide(id: string, approve: boolean, remember = false): boolean {
    const waiter = this.waiting.get(id);
    if (!waiter) return false;
    if (approve && remember) this.trust(waiter.capability);
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
