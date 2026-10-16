import { decideJarvisPolicy, type JarvisCapability } from '../services/jarvisPolicy.js';
import type { JarvisAgentDefinition, JarvisAuditEvent, JarvisToolRequest, JarvisToolResult } from './contracts.js';
import type { JarvisAuditSink } from './auditLog.js';
import type { JarvisApprovalBroker } from './approvalBroker.js';

export type JarvisToolHandler = (input: unknown, signal?: AbortSignal) => Promise<unknown>;

export class JarvisToolGateway {
  constructor(
    private readonly audit: JarvisAuditSink,
    private readonly handlers: ReadonlyMap<JarvisCapability, JarvisToolHandler> = new Map(),
    private readonly broker?: JarvisApprovalBroker,
  ) {}

  async execute(
    agent: JarvisAgentDefinition,
    taskId: string,
    request: JarvisToolRequest,
    signal?: AbortSignal,
  ): Promise<JarvisToolResult> {
    this.record({ type: 'tool.requested', taskId, agentId: agent.id, capability: request.capability, detail: 'Tool requested.' });

    if (!agent.capabilities.has(request.capability)) {
      return this.deny(taskId, agent, request.capability, 'Agent is not allowed this capability.');
    }

    let approval = request.approval;
    if (!approval && this.broker) approval = this.broker.grantIfTrusted(request.capability) ?? undefined;
    if (!approval && this.broker && this.handlers.has(request.capability)) {
      const needsApproval = !decideJarvisPolicy({ capability: request.capability, approved: false }).allowed;
      const approvable = decideJarvisPolicy({ capability: request.capability, approved: true, approvalId: 'preflight', sessionActive: true }).allowed;
      if (needsApproval && approvable) {
        this.record({ type: 'approval.requested', taskId, agentId: agent.id, capability: request.capability, detail: 'Waiting for a human decision.' });
        const granted = await this.broker.request({
          taskId, agentId: agent.id, capability: request.capability, summary: summarize(request.input),
        }, signal);
        if (!granted) return this.deny(taskId, agent, request.capability, 'Approval was denied or timed out.');
        approval = granted;
      }
    }

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
      return { ok: true, output: await handler(request.input, signal) };
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


function summarize(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input) ?? String(input);
  } catch {
    text = String(input);
  }
  return text.length > 1_000 ? `${text.slice(0, 1_000)}… (truncated)` : text;
}
