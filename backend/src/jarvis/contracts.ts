import type { JarvisCapability } from '../services/jarvisPolicy.js';

export type JarvisAgentId =
  | 'coordinator'
  | 'frontend-engineer'
  | 'backend-engineer'
  | 'security-reviewer'
  | 'memory-librarian'
  | 'screen-interpreter'
  | 'voice';

export interface JarvisTask {
  id: string;
  goal: string;
  agentId: JarvisAgentId;
  maxSteps: number;
  createdAt: string;
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
