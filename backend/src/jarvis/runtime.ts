import { JarvisAgentRegistry } from './agentRegistry.js';
import { createModelAgents, SPECIALIST_IDS } from './agents.js';
import { JarvisApprovalBroker } from './approvalBroker.js';
import { InMemoryJarvisAuditLog, type JarvisAuditSink } from './auditLog.js';
import { JarvisAuthority } from './authority.js';
import type { JarvisAgentDefinition, JarvisAgentId } from './contracts.js';
import { EncryptedJarvisAuditLog, parseAuditKey } from './encryptedAuditLog.js';
import { OllamaModelClient, type JarvisModelClient } from './model.js';
import { JarvisTaskManager } from './taskManager.js';
import { JarvisToolGateway, type JarvisToolHandler } from './toolGateway.js';
import { createFilesReadHandler } from './tools/filesRead.js';
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
    ? new OllamaModelClient(env.OLLAMA_BASE_URL, env.OLLAMA_MODEL)
    : null;
  const filesEnabled = Boolean(env.JARVIS_FILES_ROOT);

  const agents: JarvisAgentDefinition[] = model
    ? createModelAgents(model, filesEnabled)
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

  const approvals = new JarvisApprovalBroker();
  const tools = new JarvisToolGateway(audit, handlers, approvals);
  const authority = new JarvisAuthority(registry, tools, audit);
  return {
    authority, audit, model, approvals, filesEnabled,
    persistentAudit: Boolean(auditKey),
    tasks: new JarvisTaskManager(authority),
    agentIds: model ? ['coordinator', ...SPECIALIST_IDS] : ['coordinator'],
  };
}
