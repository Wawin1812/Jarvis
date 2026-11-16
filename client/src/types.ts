export type PendingApproval = { id: string; agentId: string; capability: string; summary: string };

export type AgentJob = {
  id: string;
  agentId: string;
  label: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  parentId?: string;
  summary?: string;
};

export type OrbState = 'idle' | 'listening' | 'thinking' | 'offline';

export type ChatMessage = {
  id: number;
  role: 'user' | 'jarvis' | 'error' | 'system';
  speaker?: string;
  text: string;
};

export type ServerStatus = {
  tools: string[];
  agents: string[];
  model: { provider: string; name: string } | null;
  persistentAudit: boolean;
  trusted: string[];
  knowledge: { files: number; chunks: number; updatedAt: string; embeddingModel: string } | null;
  memoryNotes: number;
};

export type AuditEvent = {
  id: string;
  type: string;
  at: string;
  agentId?: string;
  capability?: string;
  detail: string;
};
