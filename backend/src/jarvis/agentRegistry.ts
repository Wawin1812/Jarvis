import type { JarvisAgentDefinition, JarvisAgentId } from './contracts.js';

export class JarvisAgentRegistry {
  private readonly agents = new Map<JarvisAgentId, JarvisAgentDefinition>();

  register(agent: JarvisAgentDefinition): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent already registered: ${agent.id}`);
    }
    this.agents.set(agent.id, agent);
  }

  get(agentId: JarvisAgentId): JarvisAgentDefinition {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return agent;
  }
}

