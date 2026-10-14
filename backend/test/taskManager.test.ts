import { expect } from 'chai';
import { JarvisAgentRegistry } from '../src/jarvis/agentRegistry.js';
import { InMemoryJarvisAuditLog } from '../src/jarvis/auditLog.js';
import { JarvisAuthority } from '../src/jarvis/authority.js';
import type { JarvisAgentDefinition } from '../src/jarvis/contracts.js';
import { JarvisTaskManager } from '../src/jarvis/taskManager.js';
import { JarvisToolGateway } from '../src/jarvis/toolGateway.js';

describe('JARVIS task manager', () => {
  it('queues and completes a bounded background task', async () => {
    const audit = new InMemoryJarvisAuditLog();
    const registry = new JarvisAgentRegistry();
    const agent: JarvisAgentDefinition = {
      id: 'coordinator', description: 'test', capabilities: new Set(['chat']),
      async run({ task }) { return { summary: task.goal, completed: true, stepsUsed: 1 }; },
    };
    registry.register(agent);
    const manager = new JarvisTaskManager(new JarvisAuthority(registry, new JarvisToolGateway(audit, new Map()), audit));
    const queued = manager.submit('background work');
    expect(['queued', 'running', 'completed']).to.include(queued.status);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = manager.get(queued.id);
      if (current?.status === 'completed') {
        expect(current.result?.summary).to.equal('background work');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect.fail('Background task did not complete.');
  });
});

