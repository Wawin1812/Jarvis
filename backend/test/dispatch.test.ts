import { expect } from 'chai';
import { JarvisAgentRegistry } from '../src/jarvis/agentRegistry.js';
import { createModelAgents } from '../src/jarvis/agents.js';
import { InMemoryJarvisAuditLog } from '../src/jarvis/auditLog.js';
import { JarvisAuthority } from '../src/jarvis/authority.js';
import type { JarvisAgentDefinition } from '../src/jarvis/contracts.js';
import type { JarvisModelClient, JarvisModelRequest } from '../src/jarvis/model.js';
import { JarvisTaskManager } from '../src/jarvis/taskManager.js';
import { JarvisToolGateway } from '../src/jarvis/toolGateway.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i += 1) await sleep(5);
  expect(check(), 'condition not reached in time').to.equal(true);
}

describe('JARVIS task queue', () => {
  it('runs at most maxConcurrent agents and queues the rest', async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const audit = new InMemoryJarvisAuditLog();
    const registry = new JarvisAgentRegistry();
    registry.register({
      id: 'coordinator', description: 'test', capabilities: new Set(['chat']),
      async run() {
        active += 1; peak = Math.max(peak, active);
        await gate;
        active -= 1;
        return { summary: 'ok', completed: true, stepsUsed: 1 };
      },
    } satisfies JarvisAgentDefinition);
    const manager = new JarvisTaskManager(new JarvisAuthority(registry, new JarvisToolGateway(audit, new Map()), audit), 2);
    const ids = [1, 2, 3].map((n) => manager.submit(`job ${n}`).id);
    await until(() => manager.list().filter((task) => task.status === 'running').length === 2);
    expect(manager.get(ids[2])?.status).to.equal('queued');
    release();
    await until(() => manager.list().every((task) => task.status === 'completed'));
    expect(peak).to.equal(2);
  });

  it('labels tasks by the new request only', () => {
    const audit = new InMemoryJarvisAuditLog();
    const registry = new JarvisAgentRegistry();
    registry.register({ id: 'coordinator', description: 't', capabilities: new Set(['chat']), run: async () => ({ summary: 'x', completed: true, stepsUsed: 1 }) });
    const manager = new JarvisTaskManager(new JarvisAuthority(registry, new JarvisToolGateway(audit, new Map()), audit));
    expect(manager.submit('Earlier in this conversation:\nUser: hi\n\nNew request: audit the backend').label).to.equal('audit the backend');
  });
});

describe('JARVIS coordinator dispatch', () => {
  function build(coordinatorReplies: string[]) {
    const queue = [...coordinatorReplies];
    const model: JarvisModelClient = {
      provider: 'ollama', model: 'test',
      async complete(request: JarvisModelRequest) {
        if (request.instruction.includes('control unit')) return queue.shift() ?? '{"action":"final","answer":"done"}';
        await sleep(10);
        return '{"action":"final","answer":"specialist finished"}';
      },
    };
    const audit = new InMemoryJarvisAuditLog();
    const registry = new JarvisAgentRegistry();
    let manager!: JarvisTaskManager;
    createModelAgents(model, false, false, false, undefined, () => manager.statusLines()).forEach((agent) => registry.register(agent));
    const authority = new JarvisAuthority(registry, new JarvisToolGateway(audit, new Map()), audit);
    manager = new JarvisTaskManager(authority);
    authority.setDispatcher((agentId, goal, parentId) => manager.submit(goal, agentId, 8, parentId).id);
    return { authority, manager };
  }

  it('starts several agents in the background and returns to the user immediately', async () => {
    const { authority, manager } = build([
      '{"action":"dispatch","agent":"security-reviewer","goal":"audit auth"}',
      '{"action":"dispatch","agent":"backend-engineer","goal":"review api"}',
      '{"action":"final","answer":"I assigned both."}',
    ]);
    const { result, task } = await authority.run('please do both');
    expect(result.summary).to.equal('I assigned both.');
    await until(() => manager.list().length === 2 && manager.list().every((job) => job.status === 'completed'));
    expect(manager.list().map((job) => job.agentId).sort()).to.deep.equal(['backend-engineer', 'security-reviewer']);
    expect(manager.list().every((job) => job.parentId === task.id)).to.equal(true);
    expect(manager.statusLines().join('\n')).to.contain('security-reviewer').and.to.contain('done: specialist finished');
  });

  it('rejects a duplicate dispatch and the coordinator dispatching itself', async () => {
    const { authority, manager } = build([
      '{"action":"dispatch","agent":"security-reviewer","goal":"audit"}',
      '{"action":"dispatch","agent":"security-reviewer","goal":"audit"}',
      '{"action":"dispatch","agent":"coordinator","goal":"loop"}',
      '{"action":"final","answer":"ok"}',
    ]);
    expect((await authority.run('go')).result.summary).to.equal('ok');
    await until(() => manager.list().every((job) => job.status === 'completed'));
    expect(manager.list()).to.have.length(1);
  });
});

describe('JARVIS fast chat path', () => {
  function model(replies: Record<string, string>) {
    const calls: Array<{ fast: boolean; priority?: string }> = [];
    const client: JarvisModelClient = {
      provider: 'ollama', model: 'test',
      async complete(request: JarvisModelRequest) {
        const fast = request.instruction.includes('NEEDS_TOOLS');
        calls.push({ fast, priority: request.priority });
        request.onToken?.(replies[fast ? 'fast' : 'agent']);
        return replies[fast ? 'fast' : 'agent'];
      },
    };
    return { client, calls };
  }

  function authorityFor(client: JarvisModelClient) {
    const audit = new InMemoryJarvisAuditLog();
    const registry = new JarvisAgentRegistry();
    createModelAgents(client, false, false, false, undefined, undefined, undefined, true).forEach((agent) => registry.register(agent));
    return new JarvisAuthority(registry, new JarvisToolGateway(audit, new Map()), audit);
  }

  it('answers plain conversation in a single plain-text call', async () => {
    const { client, calls } = model({ fast: 'Hello there, how can I help?', agent: '{"action":"final","answer":"agent"}' });
    const { result } = await authorityFor(client).run('hello jarvis');
    expect(result.summary).to.equal('Hello there, how can I help?');
    expect(calls).to.deep.equal([{ fast: true, priority: 'foreground' }]);
  });

  it('skips the fast path for tool requests and when the model asks for tools', async () => {
    const tools = model({ fast: 'never', agent: '{"action":"final","answer":"via agent"}' });
    expect((await authorityFor(tools.client).run('search the web for cats')).result.summary).to.equal('via agent');
    expect(tools.calls.every((call) => !call.fast)).to.equal(true);

    const escalate = model({ fast: 'NEEDS_TOOLS', agent: '{"action":"final","answer":"escalated"}' });
    expect((await authorityFor(escalate.client).run('tell me something obscure')).result.summary).to.equal('escalated');
    expect(escalate.calls.map((call) => call.fast)).to.deep.equal([true, false]);
  });

  it('salvages the answer from malformed JSON instead of speaking raw JSON', async () => {
    const { client } = model({ fast: 'NEEDS_TOOLS', agent: '{"action":"final","answer":"All good, boss." trailing junk' });
    expect((await authorityFor(client).run('please check things')).result.summary).to.equal('All good, boss.');
  });
});

describe('JARVIS prioritized model client', () => {
  it('lets a foreground call pre-empt a running background call, which is then retried', async () => {
    const { PrioritizedModelClient } = await import('../src/jarvis/model.js');
    const finished: string[] = [];
    let backgroundAttempts = 0;
    const inner: JarvisModelClient = {
      provider: 'ollama', model: 'test',
      async complete(request: JarvisModelRequest) {
        if (request.priority === 'background') {
          backgroundAttempts += 1;
          if (backgroundAttempts === 1) {
            await new Promise<never>((_resolve, reject) => request.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
          }
          finished.push('background');
          return 'bg';
        }
        finished.push('foreground');
        return 'fg';
      },
    };
    const client = new PrioritizedModelClient(inner);
    const background = client.complete({ instruction: 'i', userInput: 'u', priority: 'background' });
    await sleep(10);
    expect(await client.complete({ instruction: 'i', userInput: 'u', priority: 'foreground' })).to.equal('fg');
    expect(await background).to.equal('bg');
    expect(finished).to.deep.equal(['foreground', 'background']);
    expect(backgroundAttempts).to.equal(2);
  });
});
