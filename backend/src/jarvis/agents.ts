import { runAgentLoop } from './agentLoop.js';
import type { JarvisAgentDefinition, JarvisAgentId } from './contracts.js';
import type { JarvisModelClient } from './model.js';
import type { JarvisCapability } from '../services/jarvisPolicy.js';

export const SPECIALIST_IDS = ['frontend-engineer', 'backend-engineer', 'security-reviewer', 'researcher'] as const satisfies readonly JarvisAgentId[];

const SPECIALISTS: Record<(typeof SPECIALIST_IDS)[number], { description: string; role: string }> = {
  'frontend-engineer': {
    description: 'Reviews and explains frontend code (React, TypeScript, CSS, accessibility).',
    role: 'a frontend engineer. Explain and review frontend code (React, TypeScript, CSS, accessibility) and suggest concrete improvements.',
  },
  'backend-engineer': {
    description: 'Reviews and explains backend code (APIs, data, reliability).',
    role: 'a backend engineer. Explain and review backend code (APIs, data handling, error handling, reliability) and suggest concrete improvements.',
  },
  'security-reviewer': {
    description: 'Read-only security review of code and configuration.',
    role: 'a security reviewer. Review code and configuration read-only for vulnerabilities, naming file, severity, and a fix for each finding. Do not report issues you cannot see evidence for.',
  },
  researcher: {
    description: 'Looks things up on the web and reports a short, sourced summary.',
    role: 'a researcher. Look things up with web.search (and web.fetch only if needed) and report a short summary of what you found, naming the source site.',
  },
};

export function createModelAgents(
  model: JarvisModelClient,
  filesEnabled: boolean,
  writeEnabled = false,
  webEnabled = false,
  memory?: () => string[],
  agentStatus?: () => string[],
  fastModel?: string,
  fastChat = false,
): JarvisAgentDefinition[] {
  const capabilities = new Set<JarvisCapability>(filesEnabled ? ['chat', 'files.read'] : ['chat']);
  const coordinatorCapabilities = new Set<JarvisCapability>(capabilities);
  if (writeEnabled) coordinatorCapabilities.add('files.write');
  if (webEnabled) coordinatorCapabilities.add('browser.read');
  if (memory) coordinatorCapabilities.add('memory.write');

  // The researcher is only useful (and only created) when web access is on.
  const ids = SPECIALIST_IDS.filter((id) => id !== 'researcher' || webEnabled);
  const specialists = ids.map((id): JarvisAgentDefinition => {
    const web = id === 'researcher';
    return {
      id,
      description: SPECIALISTS[id].description,
      capabilities: web ? new Set<JarvisCapability>([...capabilities, 'browser.read']) : capabilities,
      run: (context) => runAgentLoop(context, { model, role: SPECIALISTS[id].role, filesEnabled, webEnabled: web }),
    };
  });

  const coordinator: JarvisAgentDefinition = {
    id: 'coordinator',
    description: `Local ${model.provider} coordinator using ${model.model}.`,
    capabilities: coordinatorCapabilities,
    run: (context) => runAgentLoop(context, {
      model,
      filesEnabled,
      writeEnabled,
      webEnabled,
      ...(memory ? { memory } : {}),
      ...(agentStatus ? { agentStatus, canDispatch: true } : {}),
      fastChat,
      ...(fastModel ? { fastModel } : {}),
      delegateTo: ids,
      role: 'JARVIS, a warm, concise personal AI assistant and the control unit for a team of specialist agents. You talk with the user by voice. Answer directly when you can, use your tools to get things done, and hand work to the right specialist: frontend-engineer, backend-engineer or security-reviewer for code, researcher for web lookups.',
    }),
  };

  return [coordinator, ...specialists];
}
