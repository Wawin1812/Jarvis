import { runAgentLoop } from './agentLoop.js';
import type { JarvisAgentDefinition, JarvisAgentId } from './contracts.js';
import type { JarvisModelClient } from './model.js';

export const SPECIALIST_IDS = ['frontend-engineer', 'backend-engineer', 'security-reviewer'] as const satisfies readonly JarvisAgentId[];

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
};

export function createModelAgents(model: JarvisModelClient, filesEnabled: boolean, writeEnabled = false): JarvisAgentDefinition[] {
  const capabilities = new Set<'chat' | 'files.read' | 'files.write'>(filesEnabled ? ['chat', 'files.read'] : ['chat']);
  const coordinatorCapabilities = new Set(capabilities);
  if (writeEnabled) coordinatorCapabilities.add('files.write');

  const specialists = SPECIALIST_IDS.map((id): JarvisAgentDefinition => ({
    id,
    description: SPECIALISTS[id].description,
    capabilities,
    run: (context) => runAgentLoop(context, { model, role: SPECIALISTS[id].role, filesEnabled }),
  }));

  const coordinator: JarvisAgentDefinition = {
    id: 'coordinator',
    description: `Local ${model.provider} coordinator using ${model.model}.`,
    capabilities: coordinatorCapabilities,
    run: (context) => runAgentLoop(context, {
      model,
      filesEnabled,
      writeEnabled,
      delegateTo: SPECIALIST_IDS,
      role: 'JARVIS, a local personal assistant. Answer directly when you can; delegate to a specialist for code review or security review.',
    }),
  };

  return [coordinator, ...specialists];
}
