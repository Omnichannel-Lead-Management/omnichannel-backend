import { Elysia, t } from "elysia";
import {
  CORRELATION_ID_HEADER,
  correlationIdMiddleware,
  generateCorrelationId,
  logWithCorrelation
} from "../middleware/correlationId";
import { getPlatformAdapter } from "../platforms";
import { formatWhatsAppWebhook } from "../platforms/whatsapp";
import type { IncomingMessage } from "../platforms/PlatformAdapter";
import { messageOrchestrator } from "../services/MessageOrchestrator";

type OrchestratorInput = Parameters<typeof messageOrchestrator.processIncomingMessage>[0];
const WHATSAPP_MESSAGE_TTL_MS = 10 * 60 * 1000;
const seenWhatsAppMessageIds = new Map<string, number>();

function isDuplicateWhatsAppMessage(messageId: string): boolean {
  const now = Date.now();

  for (const [id, seenAt] of seenWhatsAppMessageIds.entries()) {
    if (now - seenAt > WHATSAPP_MESSAGE_TTL_MS) {
      seenWhatsAppMessageIds.delete(id);
    }
  }

  const existing = seenWhatsAppMessageIds.get(messageId);
  if (existing && now - existing <= WHATSAPP_MESSAGE_TTL_MS) {
    return true;
  }

  seenWhatsAppMessageIds.set(messageId, now);
  return false;
}

function isWhatsAppInteractiveSelection(incomingMessage: IncomingMessage): boolean {
  const metadata = incomingMessage.metadata as Record<string, unknown> | undefined;
  const type = typeof metadata?.type === "string" ? metadata.type.toLowerCase() : "";
  return type === "interactive" || type === "button";
}

async function processWhatsAppMessageAsync(
  incomingMessage: OrchestratorInput,
  correlationId: string
): Promise<void> {
  try {
    const result = await messageOrchestrator.processIncomingMessage(incomingMessage);
    if (!result.success) {
      logWithCorrelation(
        correlationId,
        "ROUTING_ERROR",
        `platform=whatsapp orchestrator failed: ${result.error ?? "unknown error"}`,
        "error"
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=whatsapp async ${errorMessage}`, "error");
  }
}

async function sendWhatsAppTapConfirmationAsync(
  incomingMessage: IncomingMessage,
  correlationId: string
): Promise<void> {
  try {
    const adapter = getPlatformAdapter("whatsapp");
    if (!adapter) {
      return;
    }

    const selectedText = incomingMessage.message.trim();
    if (!selectedText) {
      return;
    }

    const result = await adapter.sendMessage(
      incomingMessage.messenger_id,
      `Selected: ${selectedText}`,
      { request_id: correlationId }
    );

    if (!result.success) {
      logWithCorrelation(
        correlationId,
        "DOWNSTREAM_ERROR",
        `platform=whatsapp tap confirmation failed: ${result.error ?? "unknown error"}`,
        "warn"
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=whatsapp tap confirmation ${errorMessage}`, "error");
  }
}

export const whatsappRoutes = new Elysia({ prefix: "/webhook" })
  .use(correlationIdMiddleware)
  .get(
    "/whatsapp",
    (context) => {
      const { request, set } = context;
      const correlationId =
        (context as { correlationId?: string }).correlationId ?? generateCorrelationId();
      set.headers[CORRELATION_ID_HEADER] = correlationId;

      const url = new URL(request.url);
      const mode = url.searchParams.get("hub.mode");
      const verifyToken = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "";

      if (!expectedToken) {
        logWithCorrelation(correlationId, "WEBHOOK_VERIFY_FAILED", "WHATSAPP_VERIFY_TOKEN missing", "error");
        set.status = 500;
        return { ok: false, error: "Webhook verify token is not configured" };
      }

      if (mode === "subscribe" && verifyToken === expectedToken && challenge) {
        logWithCorrelation(correlationId, "WEBHOOK_VERIFIED", "platform=whatsapp mode=subscribe");
        set.status = 200;
        set.headers["content-type"] = "text/plain";
        return challenge;
      }

      logWithCorrelation(correlationId, "WEBHOOK_VERIFY_FAILED", "platform=whatsapp token mismatch", "warn");
      set.status = 403;
      return { ok: false, error: "Webhook verification failed" };
    },
    {
      detail: {
        summary: "WhatsApp webhook verification",
        description: "Meta Cloud API webhook verification endpoint.",
        tags: ["Webhooks"]
      }
    }
  )

  .post(
    "/whatsapp",
    async (context) => {
      const { body, set } = context;
      const correlationId =
        (context as { correlationId?: string }).correlationId ?? generateCorrelationId();
      set.headers[CORRELATION_ID_HEADER] = correlationId;

      try {
        logWithCorrelation(correlationId, "WEBHOOK_RECEIVED", "platform=whatsapp");
        const { messages, statuses } = await formatWhatsAppWebhook(body, correlationId);

        for (const incomingMessage of messages) {
          const messageId = String(
            (incomingMessage.metadata as Record<string, unknown>)?.message_id ?? ""
          );
          if (messageId && isDuplicateWhatsAppMessage(messageId)) {
            logWithCorrelation(
              correlationId,
              "INCOMING_IGNORED",
              `platform=whatsapp duplicate message_id=${messageId}`
            );
            continue;
          }

          incomingMessage.request_id = correlationId;
          logWithCorrelation(
            correlationId,
            "INCOMING_MESSAGE",
            `platform=whatsapp messenger_id=${incomingMessage.messenger_id} message_id=${String((incomingMessage.metadata as Record<string, unknown>)?.message_id ?? "unknown")}`
          );

          if (isWhatsAppInteractiveSelection(incomingMessage)) {
            void sendWhatsAppTapConfirmationAsync(incomingMessage, correlationId);
          }

          void processWhatsAppMessageAsync(
            incomingMessage as unknown as OrchestratorInput,
            correlationId
          );
        }

        return {
          ok: true,
          processed_messages: messages.length,
          processed_statuses: statuses.length
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Internal server error";
        logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=whatsapp ${errorMessage}`, "error");
        set.status = 500;
        return { ok: false, error: errorMessage };
      }
    },
    {
      body: t.Any(),
      detail: {
        summary: "WhatsApp webhook",
        description: "Receives message and status events from Meta WhatsApp Cloud API.",
        tags: ["Webhooks"]
      }
    }
  );
