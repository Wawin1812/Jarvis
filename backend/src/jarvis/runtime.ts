import { JarvisAgentRegistry } from './agentRegistry.js';
import { createModelAgents } from './agents.js';
import { JarvisApprovalBroker } from './approvalBroker.js';
import { InMemoryJarvisAuditLog, type JarvisAuditSink } from './auditLog.js';
import { JarvisAuthority } from './authority.js';
import type { JarvisAgentDefinition, JarvisAgentId } from './contracts.js';
import { EncryptedJarvisAuditLog, parseAuditKey } from './encryptedAuditLog.js';
import { OllamaModelClient, PrioritizedModelClient, type JarvisModelClient } from './model.js';
import { JarvisTaskManager } from './taskManager.js';
import { JarvisToolGateway, type JarvisToolHandler } from './toolGateway.js';
import { createFilesReadHandler } from './tools/filesRead.js';
import { createFilesWriteHandler } from './tools/filesWrite.js';
import { createWebReadHandler } from './tools/webRead.js';
import { createOpenHandler } from './tools/openTool.js';
import { createMemoryHandler, JarvisMemory } from './memory.js';
import type { JarvisCapability } from '../services/jarvisPolicy.js';

export interface JarvisRuntime {
  authority: JarvisAuthority;
  audit: JarvisAuditSink;
  model: JarvisModelClient | null;
  persistentAudit: boolean;
  tasks: JarvisTaskManager;
  approvals: JarvisApprovalBroker;
  agentIds: readonly JarvisAgentId[];
  filesEnabled: boolean;
  writeEnabled: boolean;
  webEnabled: boolean;
}

/**
 * Chat and read-only file access are the only wired capabilities. Every file read
 * needs a human approval issued through the approval broker.
 */
export function createJarvisRuntime(env: NodeJS.ProcessEnv = process.env): JarvisRuntime {
  const auditKey = parseAuditKey(env.JARVIS_AUDIT_KEY);
  const requirePersistentAudit = env.JARVIS_REQUIRE_PERSISTENT_AUDIT === 'true' || env.NODE_ENV === 'production';
  if (!auditKey && requirePersistentAudit) {
    throw new Error('JARVIS_AUDIT_KEY is required when persistent audit is enforced.');
  }
  const audit = auditKey
    ? new EncryptedJarvisAuditLog(`${env.JARVIS_DATA_DIR || './data/jarvis'}/audit.log`, auditKey)
    : new InMemoryJarvisAuditLog();
  const model = env.OLLAMA_BASE_URL && env.OLLAMA_MODEL
    ? new PrioritizedModelClient(new OllamaModelClient(env.OLLAMA_BASE_URL, env.OLLAMA_MODEL))
    : null;
  const filesEnabled = Boolean(env.JARVIS_FILES_ROOT);
  const writeEnabled = filesEnabled && env.JARVIS_FILES_WRITE === 'true';
  const webEnabled = env.JARVIS_WEB === 'true';
  const openEnabled = env.JARVIS_OPEN === 'true';
  const memory = new JarvisMemory(`${env.JARVIS_DATA_DIR || './data/jarvis'}/memory.json`);
  let taskManager: JarvisTaskManager | undefined;

  const agents: JarvisAgentDefinition[] = model
    ? createModelAgents(model, filesEnabled, writeEnabled, webEnabled, () => memory.list(), () => taskManager?.statusLines() ?? [], env.OLLAMA_FAST_MODEL || undefined, true, openEnabled)
    : [{
      id: 'coordinator',
      description: 'Safe baseline coordinator; chat only until a model adapter is configured.',
      capabilities: new Set(['chat']),
      async run({ task, requestTool }) {
        const response = await requestTool({ capability: 'chat', input: task.goal });
        return { summary: String(response.output ?? response.error ?? 'No response.'), completed: response.ok, stepsUsed: 1 };
      },
    }];
  const registry = new JarvisAgentRegistry();
  agents.forEach((agent) => registry.register(agent));

  const handlers = new Map<JarvisCapability, JarvisToolHandler>([
    ['chat', async (input: unknown) => `JARVIS baseline received: ${String(input)}`],
  ]);
  if (filesEnabled) handlers.set('files.read', createFilesReadHandler(env.JARVIS_FILES_ROOT as string));
  if (writeEnabled) handlers.set('files.write', createFilesWriteHandler(env.JARVIS_FILES_ROOT as string));
  if (webEnabled) handlers.set('browser.read', createWebReadHandler());
  if (openEnabled) handlers.set('browser.interact', createOpenHandler());
  if (model) handlers.set('memory.write', createMemoryHandler(memory));

  const approvals = new JarvisApprovalBroker();
  // Optional standing trust for ONE read-only capability, e.g. JARVIS_AUTO_APPROVE=browser.read
  const auto = (env.JARVIS_AUTO_APPROVE ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (auto[0]) approvals.trust(auto[0] as JarvisCapability, 365 * 24 * 3_600_000);
  const tools = new JarvisToolGateway(audit, handlers, approvals);
  const authority = new JarvisAuthority(registry, tools, audit);
  const tasks = new JarvisTaskManager(authority);
  taskManager = tasks;
  authority.setDispatcher((agentId, goal, parentId) => tasks.submit(goal, agentId, 8, parentId).id);
  return {
    authority, audit, model, approvals, filesEnabled, writeEnabled, webEnabled,
    persistentAudit: Boolean(auditKey),
    tasks,
    agentIds: agents.map((agent) => agent.id),
  };
}
