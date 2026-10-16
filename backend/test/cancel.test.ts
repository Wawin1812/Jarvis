import { expect } from 'chai';
import { JarvisAgentRegistry } from '../src/jarvis/agentRegistry.js';
import { JarvisApprovalBroker } from '../src/jarvis/approvalBroker.js';
import { InMemoryJarvisAuditLog } from '../src/jarvis/auditLog.js';
import { JarvisAuthority } from '../src/jarvis/authority.js';
import type { JarvisAgentDefinition, JarvisAgentId } from '../src/jarvis/contracts.js';
import { PrioritizedModelClient, type JarvisModelClient, type JarvisModelRequest } from '../src/jarvis/model.js';
import { JarvisTaskManager } from '../src/jarvis/taskManager.js';
import { JarvisToolGateway } from '../src/jarvis/toolGateway.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An agent that works "forever" until its signal aborts. */
function blockingAgent(id: JarvisAgentId, seen: string[]): JarvisAgentDefinition {
  return {
    id, description: 'test', capabilities: new Set(['chat']),
    run: ({ signal, task }) => new Promise((_resolve, reject) => {
      seen.push(`start:${task.goal}`);
      signal?.addEventListener('abort', () => { seen.push(`abort:${task.goal}`); reject(new Error('Cancelled.')); }, { once: true });
    }),
  };
}

function build(seen: string[], maxConcurrent = 3) {
  const audit = new InMemoryJarvisAuditLog();
  const registry = new JarvisAgentRegistry();
  registry.register(blockingAgent('coordinator', seen));
  registry.register(blockingAgent('security-reviewer', seen));
  return new JarvisTaskManager(new JarvisAuthority(registry, new JarvisToolGateway(audit, new Map()), audit), maxConcurrent);
}

describe('JARVIS cancellation', () => {
  it('stops a running task immediately and aborts its work', async () => {
    const seen: string[] = [];
    const manager = build(seen);
    const task = manager.submit('long job');
    await sleep(5);
    expect(manager.cancel(task.id)).to.equal(true);
    expect(manager.get(task.id)?.status).to.equal('cancelled');
    await sleep(5);
    expect(seen).to.include('abort:long job');
    expect(manager.get(task.id)?.status).to.equal('cancelled');
    expect(manager.cancel(task.id)).to.equal(false);
  });

  it('never starts a queued task that was cancelled and frees the slot for the next', async () => {
    const seen: string[] = [];
    const manager = build(seen, 1);
    const first = manager.submit('first');
    const second = manager.submit('second');
    const third = manager.submit('third');
    await sleep(5);
    expect(manager.cancel(second.id)).to.equal(true);
    manager.cancel(first.id);
    await sleep(10);
    expect(seen).to.not.include('start:second');
    expect(seen).to.include('start:third');
    expect(manager.get(third.id)?.status).to.equal('running');
  });

  it('cancelling a task also cancels the jobs it started, and cancelAll stops everything', async () => {
    const seen: string[] = [];
    const manager = build(seen);
    const parent = manager.submit('parent');
    const child = manager.submit('child', 'security-reviewer', 5, parent.id);
    const other = manager.submit('other');
    await sleep(5);
    manager.cancel(parent.id);
    expect(manager.get(child.id)?.status).to.equal('cancelled');
    expect(manager.get(other.id)?.status).to.equal('running');
    expect(manager.cancelAll()).to.equal(1);
    expect(manager.list().every((job) => job.status === 'cancelled')).to.equal(true);
  });
});

describe('JARVIS cancellation of waits', () => {
  it('an aborted approval request resolves null and leaves nothing pending', async () => {
    const broker = new JarvisApprovalBroker();
    const controller = new AbortController();
    const pending = broker.request({ taskId: 't', agentId: 'coordinator', capability: 'files.read', summary: '{}' }, controller.signal);
    expect(broker.list()).to.have.length(1);
    controller.abort();
    expect(await pending).to.equal(null);
    expect(broker.list()).to.have.length(0);
  });

  it('a cancelled model call is dropped from the queue or aborted in flight', async () => {
    const started: string[] = [];
    const inner: JarvisModelClient = {
      provider: 'ollama', model: 'test',
      complete: (request: JarvisModelRequest) => new Promise<string>((resolve, reject) => {
        started.push(request.userInput);
        request.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        setTimeout(() => resolve('done'), 30);
      }),
    };
    const client = new PrioritizedModelClient(inner, 1);
    const runningController = new AbortController();
    const queuedController = new AbortController();
    const running = client.complete({ instruction: '', userInput: 'running', signal: runningController.signal });
    const queued = client.complete({ instruction: '', userInput: 'queued', signal: queuedController.signal });
    queuedController.abort();
    await queued.then(() => expect.fail('queued call should be cancelled'), (error: Error) => expect(error.message).to.equal('Cancelled.'));
    runningController.abort();
    await running.then(() => expect.fail('running call should be aborted'), (error: Error) => expect(error.message).to.equal('aborted'));
    expect(started).to.deep.equal(['running']);
    expect(await client.complete({ instruction: '', userInput: 'after' })).to.equal('done');
  });
});
