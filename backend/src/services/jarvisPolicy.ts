export type JarvisCapability =
  | 'chat'
  | 'screen.read'
  | 'files.read'
  | 'files.write'
  | 'process.run'
  | 'browser.read'
  | 'browser.interact'
  | 'external.send'
  | 'memory.write';

export interface PolicyRequest {
  capability: JarvisCapability;
  approved: boolean;
  approvalId?: string;
  sessionActive?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
}

const ALWAYS_ALLOWED: ReadonlySet<JarvisCapability> = new Set(['chat']);

/**
 * Small, pure policy boundary for the first JARVIS slice.
 * It intentionally does not execute tools or inspect model output.
 */
export function decideJarvisPolicy(request: PolicyRequest): PolicyDecision {
  if (ALWAYS_ALLOWED.has(request.capability)) {
    return { allowed: true, reason: 'Capability is non-privileged.' };
  }

  if (!request.approved || !request.approvalId) {
    return { allowed: false, reason: 'Explicit approval is required.' };
  }

  if (request.capability === 'screen.read' && !request.sessionActive) {
    return { allowed: false, reason: 'Screen capture requires an active capture session.' };
  }

  if (request.capability === 'external.send') {
    return { allowed: false, reason: 'Capability is disabled in the initial release.' };
  }

  return { allowed: true, reason: 'Approved capability for the active session.' };
}

