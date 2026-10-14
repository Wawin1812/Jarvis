import { expect } from 'chai';
import { JarvisAgentRegistry } from '../src/jarvis/agentRegistry.js';
import { InMemoryJarvisAuditLog } from '../src/jarvis/auditLog.js';
import { JarvisAuthority } from '../src/jarvis/authority.js';
import type { JarvisAgentDefinition } from '../src/jarvis/contracts.js';
import { JarvisToolGateway } from '../src/jarvis/toolGateway.js';

const agent: JarvisAgentDefinition = {
  id: 'coordinator',
  description: 'Test coordinator.',
  capabilities: new Set(['chat', 'files.read']),
  async run({ task, requestTool }) {
    const result = await requestTool({ capability: 'chat', input: task.goal });
    return { summary: String(result.output), completed: result.ok, stepsUsed: 1 };
  },
};

describe('JARVIS authority', () => {
  it('dispatches tasks through the registered agent and records an audit trail', async () => {
    const audit = new InMemoryJarvisAuditLog();
    const registry = new JarvisAgentRegistry();
    registry.register(agent);
    const tools = new JarvisToolGateway(audit, new Map([
      ['chat', async (input) => `echo:${String(input)}`],
    ]));
    const authority = new JarvisAuthority(registry, tools, audit);

    const response = await authority.run('hello');

    expect(response.result).to.deep.include({ summary: 'echo:hello', completed: true, stepsUsed: 1 });
    expect(audit.list().map((event) => event.type)).to.deep.equal([
      'task.created', 'tool.requested', 'tool.allowed', 'task.completed',
    ]);
  });

  it('prevents an agent from using a capability outside its allowlist', async () => {
    const audit = new InMemoryJarvisAuditLog();
    const registry = new JarvisAgentRegistry();
    const restrictedAgent: JarvisAgentDefinition = {
      ...agent,
      capabilities: new Set(['chat']),
      async run({ task, requestTool }) {
        const result = await requestTool({ capability: 'files.read', input: task.goal });
        return { summary: result.error ?? 'unexpected', completed: result.ok, stepsUsed: 1 };
      },
    };
    registry.register(restrictedAgent);
    const authority = new JarvisAuthority(registry, new JarvisToolGateway(audit, new Map([
      ['files.read', async () => 'private'],
    ])), audit);

    const response = await authority.run('read files');

    expect(response.result.completed).to.equal(false);
    expect(response.result.summary).to.contain('not allowed');
    expect(audit.list().some((event) => event.type === 'tool.denied')).to.equal(true);
  });

  it('rejects unbounded task budgets', async () => {
    const audit = new InMemoryJarvisAuditLog();
    const registry = new JarvisAgentRegistry();
    registry.register(agent);
    const authority = new JarvisAuthority(registry, new JarvisToolGateway(audit, new Map()), audit);

    try {
      await authority.run('hello', 'coordinator', 21);
      expect.fail('Expected budget validation to fail.');
    } catch (error) {
      expect(String(error)).to.contain('maxSteps');
    }
  });
});
