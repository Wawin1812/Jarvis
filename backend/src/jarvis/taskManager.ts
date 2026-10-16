import type { JarvisAgentId, JarvisAgentResult, JarvisTask } from './contracts.js';
import type { JarvisAuthority } from './authority.js';

export type JarvisManagedTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JarvisManagedTask {
  id: string;
  status: JarvisManagedTaskStatus;
  goal: string;
  /** Short human-readable description of the request. */
  label: string;
  agentId: JarvisAgentId;
  /** Set when another agent (the coordinator) started this job. */
  parentId?: string;
  background?: boolean;
  maxSteps: number;
  createdAt: string;
  updatedAt: string;
  task?: JarvisTask;
  result?: JarvisAgentResult;
  /** Reply text generated so far, while the task is still running. */
  partial?: string;
  error?: string;
}

// UI clients prepend recent conversation to the goal; the label is just the new request.
function labelFor(goal: string): string {
  const marker = 'New request: ';
  const index = goal.lastIndexOf(marker);
  return (index >= 0 ? goal.slice(index + marker.length) : goal).replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Bounded in-process queue: at most `maxConcurrent` agents work at once, the rest wait their turn. */
export class JarvisTaskManager {
  private readonly records = new Map<string, JarvisManagedTask>();
  private readonly waiting: string[] = [];
  private running = 0;

  constructor(
    private readonly authority: JarvisAuthority,
    private readonly maxConcurrent = 3,
    private readonly maxRecords = 50,
  ) {}

  submit(goal: string, agentId: JarvisAgentId = 'coordinator', maxSteps = 10, parentId?: string, background = Boolean(parentId)): JarvisManagedTask {
    const now = new Date().toISOString();
    const record: JarvisManagedTask = {
      id: crypto.randomUUID(), status: 'queued', goal: goal.trim(), label: labelFor(goal), agentId, maxSteps,
      createdAt: now, updatedAt: now, ...(parentId ? { parentId } : {}), ...(background ? { background: true } : {}),
    };
    this.records.set(record.id, record);
    this.prune();
    this.waiting.push(record.id);
    this.pump();
    return this.copy(record);
  }

  get(id: string): JarvisManagedTask | null {
    const record = this.records.get(id);
    return record ? this.copy(record) : null;
  }

  list(): JarvisManagedTask[] {
    return [...this.records.values()].map((record) => this.copy(record));
  }

  /** One line per job that another agent started, newest last; fed to the coordinator so it can report on them. */
  statusLines(limit = 8): string[] {
    return [...this.records.values()]
      .filter((record) => record.parentId)
      .slice(-limit)
      .map((record) => {
        const outcome = record.status === 'completed' ? `done: ${record.result?.summary.slice(0, 300) ?? ''}`
          : record.status === 'failed' ? `failed: ${(record.error ?? record.result?.summary ?? '').slice(0, 150)}`
            : record.status;
        return `${record.agentId} (job ${record.id.slice(0, 8)}) on "${record.label}" - ${outcome}`;
      });
  }

  private pump(): void {
    while (this.running < this.maxConcurrent && this.waiting.length) {
      const id = this.waiting.shift() as string;
      this.running += 1;
      void this.execute(id).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async execute(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    record.status = 'running';
    record.updatedAt = new Date().toISOString();
    try {
      const response = await this.authority.run(record.goal, record.agentId, record.maxSteps, (text) => { record.partial = text; }, record.background, record.id);
      record.status = response.result.completed ? 'completed' : 'failed';
      if (!response.result.completed) record.error = response.result.summary;
      record.task = response.task;
      record.result = response.result;
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : 'Task failed.';
    } finally {
      record.updatedAt = new Date().toISOString();
    }
  }

  private prune(): void {
    for (const [id, record] of this.records) {
      if (this.records.size <= this.maxRecords) return;
      if (record.status === 'completed' || record.status === 'failed') this.records.delete(id);
    }
  }

  private copy(record: JarvisManagedTask): JarvisManagedTask {
    return { ...record, task: record.task && { ...record.task }, result: record.result && { ...record.result } };
  }
}
