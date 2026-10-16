import { JarvisAgentRegistry } from './agentRegistry.js';
import type { JarvisAuditSink } from './auditLog.js';
import type { JarvisAgentId, JarvisAgentResult, JarvisTask } from './contracts.js';
import { JarvisToolGateway } from './toolGateway.js';

const MAX_STEPS = 20;

export class JarvisAuthority {
  constructor(
    private readonly registry: JarvisAgentRegistry,
    private readonly tools: JarvisToolGateway,
    private readonly audit: JarvisAuditSink,
  ) {}

  async run(goal: string, agentId: JarvisAgentId = 'coordinator', maxSteps = 10, onPartial?: (text: string) => void): Promise<{ task: JarvisTask; result: JarvisAgentResult }> {
    return this.runTask(goal, agentId, maxSteps, 0, onPartial);
  }

  private async runTask(goal: string, agentId: JarvisAgentId, maxSteps: number, depth: number, onPartial?: (text: string) => void): Promise<{ task: JarvisTask; result: JarvisAgentResult }> {
    if (!goal.trim()) throw new Error('Task goal must not be empty.');
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS) {
      throw new Error(`maxSteps must be an integer from 1 to ${MAX_STEPS}.`);
    }

    const task: JarvisTask = {
      id: crypto.randomUUID(),
      goal: goal.trim(),
      agentId,
      maxSteps,
      createdAt: new Date().toISOString(),
    };
    const agent = this.registry.get(agentId);
    this.audit.append({ id: crypto.randomUUID(), at: new Date().toISOString(), type: 'task.created', taskId: task.id, agentId, detail: 'Task accepted.' });

    try {
      const result = await agent.run({
        task,
        requestTool: (request) => this.tools.execute(agent, task.id, request),
        ...(onPartial && depth === 0 ? { onPartial } : {}),
        // Only the top-level coordinator may delegate, and only one level deep.
        ...(agentId === 'coordinator' && depth === 0 ? {
          delegate: async (subAgentId: JarvisAgentId, subGoal: string, subSteps: number) => {
            if (subAgentId === 'coordinator') throw new Error('The coordinator cannot delegate to itself.');
            return (await this.runTask(subGoal, subAgentId, Math.min(subSteps, MAX_STEPS), depth + 1)).result;
          },
        } : {}),
      });
      if (result.stepsUsed > maxSteps) throw new Error('Agent exceeded the task step budget.');
      this.audit.append({ id: crypto.randomUUID(), at: new Date().toISOString(), type: 'task.completed', taskId: task.id, agentId, detail: 'Task completed.' });
      return { task, result };
    } catch (error) {
      this.audit.append({ id: crypto.randomUUID(), at: new Date().toISOString(), type: 'task.failed', taskId: task.id, agentId, detail: error instanceof Error ? error.message : 'Task failed.' });
      throw error;
    }
  }
}

