
import { Elysia, t } from "elysia";
import { messageOrchestrator } from "../services/MessageOrchestrator";
import { getPlatformAdapter, isPlatformSupported } from "../platforms";
import type { IncomingMessage, ReplyMessage } from "../platforms/PlatformAdapter";

export const messagingRoutes = new Elysia({ prefix: "/api/messaging" })
  .post(
    "/receive",
    async ({ body, set }) => {
      try {
        if (!isPlatformSupported(body.platform)) {
          set.status = 400;
          return {
            success: false,
            error: `Unsupported platform: ${body.platform}`
          };
        }

        if (!body.messenger_id || !body.message) {
          set.status = 400;
          return {
            success: false,
            error: "messenger_id and message are required"
          };
        }

        const result = await messageOrchestrator.processIncomingMessage(body as IncomingMessage);

        if (!result.success) {
          set.status = 500;
        }

        return result;
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Internal server error"
        };
      }
    },
    {
      body: t.Object({
        platform: t.String({ minLength: 1 }),
        messenger_id: t.String({ minLength: 1 }),
        message: t.String({ minLength: 1 }),
        first_name: t.Optional(t.String()),
        last_name: t.Optional(t.String()),
        username: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        language: t.Optional(t.String()),
        metadata: t.Optional(t.Any())
      }),
      detail: {
        summary: "Receive message from any platform",
        description: "Universal endpoint for incoming messages. Processes, stores, and forwards to AI.",
        tags: ["Messaging"]
      }
    }
  )

  .post(
    "/reply",
    async ({ body, set }) => {
      try {
        const { platform, messenger_id, reply_text, metadata } = body as ReplyMessage;

        if (!isPlatformSupported(platform)) {
          set.status = 400;
          return {
            success: false,
            error: `Unsupported platform: ${platform}`
          };
        }

        const adapter = getPlatformAdapter(platform);
        if (!adapter) {
          set.status = 500;
          return {
            success: false,
            error: `Platform adapter not found: ${platform}`
          };
        }

        await messageOrchestrator.saveReply(messenger_id, platform, reply_text, metadata);

        const result = await adapter.sendMessage(messenger_id, reply_text, metadata);

        if (!result.success) {
          set.status = 500;
        }

        return result;
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Internal server error"
        };
      }
    },
    {
      body: t.Object({
        platform: t.String({ minLength: 1 }),
        messenger_id: t.String({ minLength: 1 }),
        reply_text: t.String({ minLength: 1 }),
        metadata: t.Optional(t.Any())
      }),
      detail: {
        summary: "Send reply to user",
        description: "Called by external AI to send replies back to users on their platform.",
        tags: ["Messaging"]
      }
    }
  )

  .get(
    "/history",
    async ({ query, set }) => {
      try {
        const { session_id, messenger_id, platform, limit } = query;

        if (session_id) {
          const history = await messageOrchestrator.getFullSessionHistory(session_id, "web");
          return history;
        }

        if (!messenger_id || !platform) {
          set.status = 400;
          return {
            success: false,
            error: "session_id or (messenger_id and platform) is required"
          };
        }

        if (!isPlatformSupported(platform)) {
          set.status = 400;
          return {
            success: false,
            error: `Unsupported platform: ${platform}`
          };
        }

        const parsedLimit = limit ? parseInt(limit) : 20;
        const history = await messageOrchestrator.getRecentChatHistory(
          messenger_id,
          platform,
          Number.isNaN(parsedLimit) ? 20 : parsedLimit
        );

        const stats = await messageOrchestrator.getConversationStats(messenger_id, platform);

        return {
          success: true,
          messenger_id,
          platform,
          history,
          stats
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          error: error instanceof Error ? error.message : "Internal server error"
        };
      }
    },
    {
      query: t.Object({
        session_id: t.Optional(t.String({ minLength: 1 })),
        messenger_id: t.Optional(t.String({ minLength: 1 })),
        platform: t.Optional(t.String({ minLength: 1 })),
        limit: t.Optional(t.String())
      }),
      detail: {
        summary: "Get chat history",
        description:
          "Retrieve conversation history. Use session_id for full web-session history or messenger_id+platform for recent paged history.",
        tags: ["Messaging"]
      }
    }
  )

  .get(
    "/health",
    () => ({
      status: "healthy",
      timestamp: new Date().toISOString()
    }),
    {
      detail: {
        summary: "Health check",
        description: "Check if the messaging orchestrator is running.",
        tags: ["System"]
      }
    }
  );
