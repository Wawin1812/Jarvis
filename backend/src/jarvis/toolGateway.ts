import { decideJarvisPolicy, type JarvisCapability } from '../services/jarvisPolicy.js';
import type { JarvisAgentDefinition, JarvisAuditEvent, JarvisToolRequest, JarvisToolResult } from './contracts.js';
import type { JarvisAuditSink } from './auditLog.js';

export type JarvisToolHandler = (input: unknown) => Promise<unknown>;

export class JarvisToolGateway {
  constructor(
    private readonly audit: JarvisAuditSink,
    private readonly handlers: ReadonlyMap<JarvisCapability, JarvisToolHandler> = new Map(),
  ) {}

  async execute(
    agent: JarvisAgentDefinition,
    taskId: string,
    request: JarvisToolRequest,
  ): Promise<JarvisToolResult> {
    this.record({ type: 'tool.requested', taskId, agentId: agent.id, capability: request.capability, detail: 'Tool requested.' });

    if (!agent.capabilities.has(request.capability)) {
      return this.deny(taskId, agent, request.capability, 'Agent is not allowed this capability.');
    }

    const approval = request.approval;
    const approved = Boolean(approval && approval.capability === request.capability && Date.parse(approval.expiresAt) > Date.now());
    const decision = decideJarvisPolicy({
      capability: request.capability,
      approved,
      approvalId: approval?.id,
      sessionActive: approval?.sessionActive,
    });

    if (!decision.allowed) return this.deny(taskId, agent, request.capability, decision.reason);

    const handler = this.handlers.get(request.capability);
    if (!handler) return this.deny(taskId, agent, request.capability, 'No tool handler is installed.');

    this.record({ type: 'tool.allowed', taskId, agentId: agent.id, capability: request.capability, detail: decision.reason });
    try {
      return { ok: true, output: await handler(request.input) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Tool failed.' };
    }
  }

  private deny(taskId: string, agent: JarvisAgentDefinition, capability: JarvisCapability, reason: string): JarvisToolResult {
    this.record({ type: 'tool.denied', taskId, agentId: agent.id, capability, detail: reason });
    return { ok: false, error: reason };
  }

  private record(event: Omit<JarvisAuditEvent, 'id' | 'at'>): void {
    this.audit.append({ ...event, id: crypto.randomUUID(), at: new Date().toISOString() });
  }
}

