import { Elysia } from "elysia";
import { agentHub } from "../services/AgentHub";

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  .get("/status", async ({ query }) => {
    const business_id = typeof query.business_id === "string" ? query.business_id : undefined;
    const queue = await agentHub.getEscalatedQueue(business_id);

    return {
      success: true,
      connected_agents: agentHub.getConnectedAgentCount(),
      escalated_chats: queue.length,
      timestamp: new Date().toISOString()
    };
  })
  .get("/queue", async ({ query }) => {
    const business_id = typeof query.business_id === "string" ? query.business_id : undefined;
    const queue = await agentHub.getEscalatedQueue(business_id);

    return {
      success: true,
      connected_agents: agentHub.getConnectedAgentCount(),
      queue
    };
  });
