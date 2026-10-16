import type { JarvisCapability } from '../services/jarvisPolicy.js';

export type JarvisAgentId =
  | 'coordinator'
  | 'frontend-engineer'
  | 'backend-engineer'
  | 'security-reviewer'
  | 'researcher'
  | 'memory-librarian'
  | 'screen-interpreter'
  | 'voice';

export interface JarvisTask {
  id: string;
  goal: string;
  agentId: JarvisAgentId;
  maxSteps: number;
  createdAt: string;
  /** True for jobs the user is not waiting on; their model calls yield to foreground ones. */
  background?: boolean;
}

export interface JarvisApproval {
  id: string;
  capability: JarvisCapability;
  expiresAt: string;
  sessionActive?: boolean;
}

export interface JarvisAgentContext {
  task: JarvisTask;
  requestTool: (request: JarvisToolRequest) => Promise<JarvisToolResult>;
  /** Receives the reply text as it is being generated (top-level agent only). */
  onPartial?: (text: string) => void;
  /** Aborted when the user stops the task; every model call, approval wait and web fetch honours it. */
  signal?: AbortSignal;
  /** Starts another agent as a background job and returns its job id (coordinator only). */
  dispatch?: (agentId: JarvisAgentId, goal: string) => string;
  /** Present only for the coordinator; the specialist runs with its own capabilities. */
  delegate?: (agentId: JarvisAgentId, goal: string, maxSteps: number) => Promise<JarvisAgentResult>;
}

export interface JarvisAgentResult {
  summary: string;
  completed: boolean;
  stepsUsed: number;
}

export interface JarvisAgentDefinition {
  id: JarvisAgentId;
  description: string;
  capabilities: ReadonlySet<JarvisCapability>;
  run: (context: JarvisAgentContext) => Promise<JarvisAgentResult>;
}

export interface JarvisToolRequest {
  capability: JarvisCapability;
  approval?: JarvisApproval;
  input: unknown;
}

export interface JarvisToolResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

export type JarvisAuditEventType =
  | 'task.created'
  | 'task.completed'
  | 'task.failed'
  | 'tool.requested'
  | 'tool.allowed'
  | 'tool.denied'
  | 'approval.requested'
  | 'screen.analyzed';

export interface JarvisAuditEvent {
  id: string;
  type: JarvisAuditEventType;
  at: string;
  taskId?: string;
  agentId?: JarvisAgentId;
  capability?: JarvisCapability;
  detail: string;
}
