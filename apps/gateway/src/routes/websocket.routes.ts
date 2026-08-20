
import { Elysia } from "elysia";
import { getPlatformAdapter } from "../platforms";
import { WebAdapter, generateWebSessionId } from "../platforms/WebAdapter";
import { generateCorrelationId, logWithCorrelation } from "../middleware/correlationId";
import { messageOrchestrator } from "../services/MessageOrchestrator";
import { isOriginAllowed, wsChatRateLimitConfig } from "../services/SecurityConfig";
import { WebSocketRateLimiter } from "../services/WebSocketRateLimiter";

interface WebSocketData {
  session_id?: string;
  request_id?: string;
}

interface IncomingWebSocketMessage {
  type?: string;
  session_id?: string;
  message?: string;
  url?: string;
  first_name?: string;
  last_name?: string;
  language?: string;
}

const chatRateLimiter = new WebSocketRateLimiter({
  keyPrefix: "ws-chat",
  maxMessages: wsChatRateLimitConfig.maxMessages,
  windowMs: wsChatRateLimitConfig.windowMs
});

function rejectRateLimitedMessage(ws: any, retryAfterMs: number): void {
  ws.send(JSON.stringify({
    type: "error",
    message: "Rate limit exceeded. Please slow down.",
    retry_after_ms: retryAfterMs
  }));
  ws.close(1013, "Rate limit exceeded");
}

export const websocketRoutes = new Elysia()
  .ws("/ws/chat", {
    beforeHandle({ request, set }) {
      if (isOriginAllowed(request.headers.get("origin"))) return;

      set.status = 403;
      return {
        success: false,
        error: "Origin not allowed."
      };
    },

    open(ws) {
      const session_id = generateWebSessionId();
      const request_id = generateCorrelationId();
      (ws.data as WebSocketData).session_id = session_id;
      (ws.data as WebSocketData).request_id = request_id;

      const adapter = getPlatformAdapter("web") as WebAdapter;
      if (adapter) {
        adapter.registerConnection(session_id, ws as any);
      }

      ws.send(JSON.stringify({
        type: "connected",
        session_id,
        request_id,
        x_request_id: request_id,
        message: "Connected to Messaging Orchestrator"
      }));

      logWithCorrelation(request_id, "WS_OPEN", `platform=web session_id=${session_id}`);
    },

    async message(ws, data) {
      try {
        let session_id = (ws.data as WebSocketData).session_id;
        const request_id =
          (ws.data as WebSocketData).request_id ?? generateCorrelationId();

        if (!(ws.data as WebSocketData).request_id) {
          (ws.data as WebSocketData).request_id = request_id;
        }

        if (!session_id) {
          ws.send(JSON.stringify({
            type: "error",
            request_id,
            message: "Session not initialized"
          }));
          logWithCorrelation(request_id, "WS_ERROR", "session not initialized", "error");
          return;
        }

        let payload: IncomingWebSocketMessage | null = null;
        if (data && typeof data === "object") {
          payload = data as IncomingWebSocketMessage;
        } else if (typeof data === "string") {
          try {
            const parsed = JSON.parse(data) as unknown;
            if (parsed && typeof parsed === "object") {
              payload = parsed as IncomingWebSocketMessage;
            }
          } catch {
            payload = null;
          }
        }

        const requestedSessionId = payload?.session_id?.trim();
        if (requestedSessionId) {
          const adapter = getPlatformAdapter("web") as WebAdapter | null;
          const previousSessionId = session_id;
          const normalizedRequestedSession = requestedSessionId.startsWith("web_")
            ? requestedSessionId
            : `web_${requestedSessionId}`;

          if (!/^web_[a-zA-Z0-9_-]+$/.test(normalizedRequestedSession)) {
            ws.send(JSON.stringify({
              type: "error",
              request_id,
              message: "Invalid session_id format"
            }));
            logWithCorrelation(request_id, "WS_ERROR", "invalid session_id format", "warn");
            return;
          }

          if (session_id !== normalizedRequestedSession) {
            if (adapter && session_id) {
              adapter.unregisterConnection(session_id);
            }

            (ws.data as WebSocketData).session_id = normalizedRequestedSession;
            session_id = normalizedRequestedSession;

            if (adapter) {
              adapter.registerConnection(session_id, ws as any);
            }

            logWithCorrelation(
              request_id,
              "WS_SESSION_RESTORE",
              `platform=web previous_session_id=${previousSessionId ?? "none"} restored_session_id=${session_id}`
            );
          }

          const isImagePayload = payload.type === "image";
          const isHandshakePayload = payload.type === "handshake" || (!payload.message && !isImagePayload);
          if (isHandshakePayload || previousSessionId !== session_id) {
            ws.send(JSON.stringify({
              type: "connected",
              session_id,
              request_id,
              x_request_id: request_id,
              resumed: true
            }));
          }

          if (isHandshakePayload) {
            return;
          }
        }

        const rateLimit = chatRateLimiter.consume(ws);
        if (!rateLimit.allowed) {
          rejectRateLimitedMessage(ws, rateLimit.retryAfterMs);
          return;
        }

        if (payload?.type === "image") {
          const imageUrl = typeof payload.url === "string" ? payload.url.trim() : "";
          if (!imageUrl) {
            ws.send(JSON.stringify({
              type: "error",
              request_id,
              message: "Invalid image message format"
            }));
            logWithCorrelation(request_id, "WS_ERROR", "missing image url", "warn");
            return;
          }

          const caption = typeof payload.message === "string" ? payload.message.trim() : "";
          const imageMessageText = caption || "[Photo]";

          logWithCorrelation(
            request_id,
            "INCOMING_MESSAGE",
            `platform=web session_id=${session_id} type=image url=${imageUrl}`
          );

          const result = await messageOrchestrator.processIncomingMessage({
            request_id,
            platform: "web",
            messenger_id: session_id,
            message: imageMessageText,
            image_url: imageUrl,
            first_name: payload.first_name,
            last_name: payload.last_name,
            language: payload.language || "en",
            metadata: {
              type: "image",
              image_url: imageUrl
            }
          });

          if (!result.success) {
            ws.send(JSON.stringify({
              type: "error",
              request_id,
              message: result.error || "Failed to process image message"
            }));
            logWithCorrelation(
              request_id,
              "WS_ERROR",
              `orchestrator image processing failed: ${result.error || "unknown error"}`,
              "error"
            );
          }
          return;
        }

        if (!payload?.message || typeof payload.message !== "string") {
          ws.send(JSON.stringify({
            type: "error",
            request_id,
            message: "Invalid message format"
          }));
          logWithCorrelation(request_id, "WS_ERROR", "invalid message format", "warn");
          return;
        }

        logWithCorrelation(
          request_id,
          "INCOMING_MESSAGE",
          `platform=web session_id=${session_id} text="${payload.message}"`
        );

        const result = await messageOrchestrator.processIncomingMessage({
          request_id,
          platform: "web",
          messenger_id: session_id,
          message: payload.message,
          first_name: payload.first_name,
          last_name: payload.last_name,
          language: payload.language || "en"
        });

        if (!result.success) {
          ws.send(JSON.stringify({
            type: "error",
            request_id,
            message: result.error || "Failed to process message"
          }));
          logWithCorrelation(
            request_id,
            "WS_ERROR",
            `orchestrator processing failed: ${result.error || "unknown error"}`,
            "error"
          );
        }
      } catch (error) {
        const request_id =
          (ws.data as WebSocketData).request_id ?? generateCorrelationId();
        const message = error instanceof Error ? error.message : "Unknown error";
        logWithCorrelation(request_id, "WS_ERROR", `message handler failure: ${message}`, "error");
        ws.send(JSON.stringify({
          type: "error",
          request_id,
          message: "Internal server error"
        }));
      }
    },

    close(ws) {
      const session_id = (ws.data as WebSocketData).session_id;
      const request_id = (ws.data as WebSocketData).request_id;
      if (!session_id) return;

      const adapter = getPlatformAdapter("web") as WebAdapter;
      if (adapter) {
        adapter.unregisterConnection(session_id);
      }

      if (request_id) {
        logWithCorrelation(request_id, "WS_CLOSE", `platform=web session_id=${session_id}`);
      } else {
        console.log(`🌐 WebSocket closed: ${session_id}`);
      }
    }
  });
