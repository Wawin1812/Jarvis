import type { JarvisAgentId, JarvisAgentResult, JarvisTask } from './contracts.js';
import type { JarvisAuthority } from './authority.js';

export type JarvisManagedTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JarvisManagedTask {
  id: string;
  status: JarvisManagedTaskStatus;
  goal: string;
  agentId: JarvisAgentId;
  maxSteps: number;
  createdAt: string;
  updatedAt: string;
  task?: JarvisTask;
  result?: JarvisAgentResult;
  error?: string;
}

/** Bounded in-process queue. A durable distributed queue is intentionally a later adapter. */
export class JarvisTaskManager {
  private readonly records = new Map<string, JarvisManagedTask>();

  constructor(private readonly authority: JarvisAuthority) {}

  submit(goal: string, agentId: JarvisAgentId = 'coordinator', maxSteps = 10): JarvisManagedTask {
    const now = new Date().toISOString();
    const record: JarvisManagedTask = {
      id: crypto.randomUUID(), status: 'queued', goal: goal.trim(), agentId, maxSteps,
      createdAt: now, updatedAt: now,
    };
    this.records.set(record.id, record);
    void this.execute(record.id);
    return this.copy(record);
  }

  get(id: string): JarvisManagedTask | null {
    const record = this.records.get(id);
    return record ? this.copy(record) : null;
  }

  list(): JarvisManagedTask[] {
    return [...this.records.values()].map((record) => this.copy(record));
  }

  private async execute(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    record.status = 'running';
    record.updatedAt = new Date().toISOString();
    try {
      const response = await this.authority.run(record.goal, record.agentId, record.maxSteps);
      record.status = 'completed';
      record.task = response.task;
      record.result = response.result;
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : 'Task failed.';
    } finally {
      record.updatedAt = new Date().toISOString();
    }
  }

  private copy(record: JarvisManagedTask): JarvisManagedTask {
    return { ...record, task: record.task && { ...record.task }, result: record.result && { ...record.result } };
  }
}

