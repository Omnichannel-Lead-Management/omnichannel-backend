import { Elysia } from "elysia";
import { agentHub } from "../services/AgentHub";
import { agentAuthService } from "../services/AgentAuth";
import { isOriginAllowed, wsAgentRateLimitConfig } from "../services/SecurityConfig";
import { WebSocketRateLimiter } from "../services/WebSocketRateLimiter";

interface AgentSocketData {
  agent_id?: string;
}

const agentRateLimiter = new WebSocketRateLimiter({
  keyPrefix: "ws-agent",
  maxMessages: wsAgentRateLimitConfig.maxMessages,
  windowMs: wsAgentRateLimitConfig.windowMs
});

function rejectRateLimitedMessage(ws: any, retryAfterMs: number): void {
  ws.send(JSON.stringify({
    type: "error",
    message: "Rate limit exceeded. Please slow down.",
    retry_after_ms: retryAfterMs
  }));
  ws.close(1013, "Rate limit exceeded");
}

export const agentWebsocketRoutes = new Elysia().ws("/ws/agents", {
  beforeHandle({ request, set }) {
    if (isOriginAllowed(request.headers.get("origin"))) return;

    set.status = 403;
    return {
      success: false,
      error: "Origin not allowed."
    };
  },

  open(ws) {
    ws.send(JSON.stringify({
      type: "connected",
      message: "Connected to agent channel. Please register.",
      requires_registration: true
    }));
  },

  async message(ws, data) {
    try {
      const rateLimit = agentRateLimiter.consume(ws);
      if (!rateLimit.allowed) {
        rejectRateLimitedMessage(ws, rateLimit.retryAfterMs);
        return;
      }

      if (!data || typeof data !== "object") {
        ws.send(JSON.stringify({ type: "error", message: "Invalid payload." }));
        return;
      }

      const action = (data as { type?: string }).type;
      if (!action) {
        ws.send(JSON.stringify({ type: "error", message: "Message type is required." }));
        return;
      }

      if (action === "register") {
        const payload = data as { agent_id?: string; agent_name?: string; token?: string; business_id?: string };
        const authResult = await agentAuthService.authenticate(payload.token);

        if (!authResult.success) {
          ws.send(JSON.stringify({
            type: "auth_failed",
            success: false,
            error: authResult.error || "Authentication failed."
          }));
          ws.close(4003, "Unauthorized");
          return;
        }

        // Auth modes static/jwt derive business_id from the verified token/claim (an
        // `identity` object is always present in those modes, even if its business_id
        // is undefined for a "super agent" token). In "none" mode no identity is ever
        // returned, so there's no auth boundary anyway — trust the client-supplied value.
        const business_id =
          authResult.identity !== undefined ? authResult.identity.business_id : payload.business_id;

        const registration = agentHub.registerAgent(ws as any, {
          agent_id: authResult.identity?.agent_id || payload.agent_id,
          agent_name: authResult.identity?.agent_name || payload.agent_name,
          business_id
        });
        await agentHub.sendQueueSnapshotToAgent(registration.agent_id);
        return;
      }

      const agent_id = (ws.data as AgentSocketData).agent_id;
      if (!agent_id) {
        ws.send(JSON.stringify({
          type: "error",
          message: "You must register first.",
          expected: { type: "register", token: "required when auth is enabled", agent_id: "optional", agent_name: "optional" }
        }));
        return;
      }

      if (action === "get_queue") {
        await agentHub.sendQueueSnapshotToAgent(agent_id);
        return;
      }

      if (action === "claim_chat") {
        const payload = data as { platform?: string; messenger_id?: string; business_id?: string };

        if (!payload.platform || !payload.messenger_id) {
          ws.send(JSON.stringify({ type: "claim_result", success: false, error: "platform and messenger_id are required." }));
          return;
        }

        const result = await agentHub.claimChat(agent_id, payload.platform, payload.messenger_id, payload.business_id);
        ws.send(JSON.stringify({
          type: "claim_result",
          success: result.success,
          error: result.error,
          platform: payload.platform,
          messenger_id: payload.messenger_id,
          history: result.history,
          next_cursor: result.next_cursor ?? null,
          has_more: result.has_more ?? false
        }));

        return;
      }

      if (action === "release_chat") {
        const payload = data as { platform?: string; messenger_id?: string; business_id?: string };

        if (!payload.platform || !payload.messenger_id) {
          ws.send(JSON.stringify({ type: "release_result", success: false, error: "platform and messenger_id are required." }));
          return;
        }

        const result = await agentHub.releaseChat(agent_id, payload.platform, payload.messenger_id, payload.business_id);
        ws.send(JSON.stringify({
          type: "release_result",
          success: result.success,
          error: result.error,
          platform: payload.platform,
          messenger_id: payload.messenger_id
        }));

        return;
      }

      if (action === "send_message") {
        const payload = data as { platform?: string; messenger_id?: string; message?: string; business_id?: string };

        if (!payload.platform || !payload.messenger_id || !payload.message) {
          ws.send(JSON.stringify({ type: "send_result", success: false, error: "platform, messenger_id, and message are required." }));
          return;
        }

        const result = await agentHub.sendAgentMessage(agent_id, payload.platform, payload.messenger_id, payload.message, payload.business_id);
        ws.send(JSON.stringify({
          type: "send_result",
          success: result.success,
          error: result.error,
          platform: payload.platform,
          messenger_id: payload.messenger_id
        }));

        return;
      }

      if (action === "get_history") {
        const payload = data as {
          platform?: string;
          messenger_id?: string;
          limit?: number;
          cursor?: number;
          append?: boolean;
          business_id?: string;
        };

        if (!payload.platform || !payload.messenger_id) {
          ws.send(JSON.stringify({ type: "history", success: false, error: "platform and messenger_id are required." }));
          return;
        }

        const historyPage = await agentHub.getHistory(
          payload.platform,
          payload.messenger_id,
          payload.limit,
          payload.cursor,
          payload.business_id
        );

        ws.send(JSON.stringify({
          type: "history",
          success: true,
          platform: payload.platform,
          messenger_id: payload.messenger_id,
          history: historyPage.history,
          next_cursor: historyPage.next_cursor,
          has_more: historyPage.has_more,
          cursor: payload.cursor ?? null,
          append: payload.append === true
        }));

        return;
      }

      ws.send(JSON.stringify({
        type: "error",
        message: `Unsupported action: ${action}`
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: "error",
        message: error instanceof Error ? error.message : "Internal server error"
      }));
    }
  },

  close(ws) {
    agentHub.unregisterSocket(ws as any);
  }
});
