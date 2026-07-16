import { Elysia } from "elysia";
import { agentHub } from "../services/AgentHub";

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  .get("/status", async () => {
    const queue = await agentHub.getEscalatedQueue();

    return {
      success: true,
      connected_agents: agentHub.getConnectedAgentCount(),
      escalated_chats: queue.length,
      timestamp: new Date().toISOString()
    };
  })
  .get("/queue", async () => {
    const queue = await agentHub.getEscalatedQueue();

    return {
      success: true,
      connected_agents: agentHub.getConnectedAgentCount(),
      queue
    };
  });
