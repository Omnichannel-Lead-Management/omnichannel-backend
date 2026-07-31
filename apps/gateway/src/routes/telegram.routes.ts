/**
 * Telegram Webhook Routes
 *
 * Handles incoming Telegram bot webhooks
 */

import { Elysia, t } from "elysia";
import {
  CORRELATION_ID_HEADER,
  correlationIdMiddleware,
  generateCorrelationId,
  logWithCorrelation
} from "../middleware/correlationId";
import { messageOrchestrator } from "../services/MessageOrchestrator";
import { TelegramAdapter, formatTelegramWebhook } from "../platforms/TelegramAdapter";
import {
  transcribeVoice,
  describeCustomerImage,
  photoMessageText,
  voiceMessageText
} from "../services/MediaUnderstanding";
import { getBusinessById } from "../services/BusinessRegistry";

const telegramAdapter = new TelegramAdapter();
const CALLBACK_QUERY_TTL_MS = 10 * 60 * 1000;
const seenCallbackQueries = new Map<string, number>();

function isDuplicateCallbackQuery(callbackQueryId: string): boolean {
  const now = Date.now();

  for (const [id, seenAt] of seenCallbackQueries.entries()) {
    if (now - seenAt > CALLBACK_QUERY_TTL_MS) {
      seenCallbackQueries.delete(id);
    }
  }

  const existing = seenCallbackQueries.get(callbackQueryId);
  if (existing && now - existing <= CALLBACK_QUERY_TTL_MS) {
    return true;
  }

  seenCallbackQueries.set(callbackQueryId, now);
  return false;
}

type OrchestratorInput = Parameters<typeof messageOrchestrator.processIncomingMessage>[0];

async function processTelegramMessageAsync(
  formattedMessage: Record<string, unknown>,
  correlationId: string,
  adapter: TelegramAdapter = telegramAdapter
): Promise<void> {
  const mutableMessage = formattedMessage as Record<string, unknown> & {
    _photo_file_id?: string;
    _audio_file_id?: string;
    _caption?: string;
    message?: string;
    language?: string;
    business_id?: string;
    metadata?: Record<string, unknown>;
  };

  try {
    // Photos and voice notes are resolved to TEXT here, at the edge. Everything
    // downstream (routing, chatbot, lead-manager, appointment) speaks plain text,
    // so this is the only place that has to know media exists.
    if (mutableMessage._photo_file_id) {
      const fileData = await adapter.downloadFile(mutableMessage._photo_file_id, correlationId);
      if (fileData) {
        // The tenant's sector shapes the description — a salon and a photographer
        // want different things noticed in the same photo.
        let sector: string | undefined;
        if (typeof mutableMessage.business_id === "string") {
          try {
            const business = await getBusinessById(mutableMessage.business_id);
            sector = business?.sector ?? undefined;
          } catch {
            sector = undefined;
          }
        }

        const understanding = await describeCustomerImage(fileData.data, fileData.mimeType, sector);
        mutableMessage.message = photoMessageText(understanding, mutableMessage._caption);
        mutableMessage.metadata = { ...(mutableMessage.metadata ?? {}), type: "photo" };

        logWithCorrelation(
          correlationId,
          understanding ? "MEDIA_UNDERSTOOD" : "MEDIA_UNREADABLE",
          `platform=telegram kind=photo description="${understanding?.description ?? "-"}"`,
          understanding ? "log" : "warn"
        );
      } else {
        mutableMessage.message = photoMessageText(null, mutableMessage._caption);
        mutableMessage.metadata = { ...(mutableMessage.metadata ?? {}), type: "photo" };
        logWithCorrelation(correlationId, "MEDIA_DOWNLOAD_FAILED", "platform=telegram kind=photo", "warn");
      }
      delete mutableMessage._photo_file_id;
    }

    if (mutableMessage._audio_file_id) {
      const fileData = await adapter.downloadFile(mutableMessage._audio_file_id, correlationId);
      if (fileData) {
        const transcript = await transcribeVoice(fileData.data, fileData.mimeType);
        mutableMessage.message = voiceMessageText(transcript, mutableMessage._caption);
        mutableMessage.metadata = { ...(mutableMessage.metadata ?? {}), type: "voice" };

        logWithCorrelation(
          correlationId,
          transcript ? "VOICE_TRANSCRIBED" : "VOICE_UNREADABLE",
          `platform=telegram transcript="${transcript?.slice(0, 80) ?? "-"}"`,
          transcript ? "log" : "warn"
        );
      } else {
        mutableMessage.message = voiceMessageText(null, mutableMessage._caption);
        mutableMessage.metadata = { ...(mutableMessage.metadata ?? {}), type: "voice" };
        logWithCorrelation(correlationId, "MEDIA_DOWNLOAD_FAILED", "platform=telegram kind=voice", "warn");
      }
      delete mutableMessage._audio_file_id;
    }

    delete mutableMessage._caption;

    const result = await messageOrchestrator.processIncomingMessage(
      mutableMessage as unknown as OrchestratorInput
    );

    if (!result.success) {
      logWithCorrelation(
        correlationId,
        "ROUTING_ERROR",
        `platform=telegram orchestrator failed: ${result.error ?? "unknown error"}`,
        "error"
      );
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=telegram async ${errorMessage}`, "error");
  }
}

export const telegramRoutes = new Elysia({ prefix: "/webhook" })
  .use(correlationIdMiddleware)
  /**
   * POST /webhook/telegram
   *
   * Telegram webhook endpoint
   * Telegram will send updates here when messages arrive
   */
  .post(
    "/telegram",
    async (context) => {
      const { body, request, set } = context;
      const correlationId =
        (context as { correlationId?: string }).correlationId ?? generateCorrelationId();
      set.headers[CORRELATION_ID_HEADER] = correlationId;

      try {
        const expectedSecret = process.env.TELEGRAM_SECRET?.trim() ?? "";
        if (!expectedSecret) {
          logWithCorrelation(
            correlationId,
            "WEBHOOK_AUTH_FAILED",
            "platform=telegram TELEGRAM_SECRET not configured",
            "error"
          );
          set.status = 500;
          return { ok: false, error: "TELEGRAM_SECRET is not configured" };
        }

        const providedSecret =
          request.headers.get("x-telegram-bot-api-secret-token")?.trim() ?? "";

        if (!providedSecret || providedSecret !== expectedSecret) {
          logWithCorrelation(
            correlationId,
            "WEBHOOK_AUTH_FAILED",
            "platform=telegram invalid or missing secret token",
            "warn"
          );
          set.status = 403;
          return { ok: false, error: "Forbidden" };
        }

        logWithCorrelation(correlationId, "WEBHOOK_RECEIVED", "platform=telegram");

        const callbackQueryId =
          typeof (body as { callback_query?: { id?: unknown } })?.callback_query?.id === "string"
            ? ((body as { callback_query?: { id?: string } }).callback_query?.id ?? "")
            : "";

        if (callbackQueryId) {
          if (isDuplicateCallbackQuery(callbackQueryId)) {
            logWithCorrelation(
              correlationId,
              "INCOMING_IGNORED",
              `platform=telegram duplicate callback_query_id=${callbackQueryId}`
            );
            return { ok: true };
          }

          const formattedCallbackMessage = formatTelegramWebhook(body);
          if (!formattedCallbackMessage) {
            logWithCorrelation(correlationId, "INCOMING_IGNORED", "platform=telegram unsupported callback payload");
            return { ok: true };
          }

          formattedCallbackMessage.request_id = correlationId;
          logWithCorrelation(
            correlationId,
            "INCOMING_MESSAGE",
            `platform=telegram messenger_id=${formattedCallbackMessage.messenger_id} message_id=${String((formattedCallbackMessage.metadata as Record<string, unknown>)?.message_id ?? "unknown")}`
          );

          void (async () => {
            try {
              const ack = await telegramAdapter.answerCallbackQuery(callbackQueryId, {
                request_id: correlationId
              });

              if (!ack.success) {
                const ackError = ack.error ?? "unknown error";
                const isExpiredQuery = ackError.toLowerCase().includes("query is too old");
                logWithCorrelation(
                  correlationId,
                  "DOWNSTREAM_ERROR",
                  `platform=telegram answerCallbackQuery failed: ${ackError}`,
                  isExpiredQuery ? "info" : "warn"
                );
              }

              await processTelegramMessageAsync(formattedCallbackMessage, correlationId);
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : "Internal server error";
              logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=telegram async callback ${errorMessage}`, "error");
            }
          })();

          return { ok: true };
        }

        // Format Telegram update to standard format
        const formattedMessage = formatTelegramWebhook(body);

        if (!formattedMessage) {
          // Not a supported message type, ignore
          logWithCorrelation(correlationId, "INCOMING_IGNORED", "platform=telegram unsupported payload");
          return { ok: true };
        }

        formattedMessage.request_id = correlationId;
        logWithCorrelation(
          correlationId,
          "INCOMING_MESSAGE",
          `platform=telegram messenger_id=${formattedMessage.messenger_id} message_id=${String((formattedMessage.metadata as Record<string, unknown>)?.message_id ?? "unknown")}`
        );

        void processTelegramMessageAsync(formattedMessage, correlationId);

        return { ok: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Internal server error";
        logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=telegram ${errorMessage}`, "error");
        set.status = 500;
        return {
          ok: false,
          error: errorMessage
        };
      }
    },
    {
      body: t.Any(),
      detail: {
        summary: "Telegram webhook",
        description: "Receives updates from Telegram Bot API.",
        tags: ["Webhooks"]
      }
    }
  )

  /**
   * GET /webhook/telegram
   *
   * Health check for webhook
   */
  .get("/telegram", () => ({
    status: "Telegram webhook is active",
    timestamp: new Date().toISOString()
  }))

  /**
   * POST /webhook/telegram/:business_id
   *
   * Multi-tenant Telegram webhook — each registered business gets its own bot
   * and its own webhook path (see BusinessRegistry.connectTelegram). The secret
   * token is validated against that business's own stored secret, not a global env var.
   */
  .post(
    "/telegram/:business_id",
    async (context) => {
      const { body, request, set, params } = context;
      const correlationId =
        (context as { correlationId?: string }).correlationId ?? generateCorrelationId();
      set.headers[CORRELATION_ID_HEADER] = correlationId;
      const businessId = params.business_id;

      try {
        const business = await getBusinessById(businessId);
        if (!business || !business.telegram_webhook_secret || !business.telegram_bot_token) {
          logWithCorrelation(
            correlationId,
            "WEBHOOK_AUTH_FAILED",
            `platform=telegram business_id=${businessId} not registered for Telegram`,
            "warn"
          );
          set.status = 404;
          return { ok: false, error: "Business not found or Telegram not connected" };
        }

        const providedSecret =
          request.headers.get("x-telegram-bot-api-secret-token")?.trim() ?? "";

        if (!providedSecret || providedSecret !== business.telegram_webhook_secret) {
          logWithCorrelation(
            correlationId,
            "WEBHOOK_AUTH_FAILED",
            `platform=telegram business_id=${businessId} invalid or missing secret token`,
            "warn"
          );
          set.status = 403;
          return { ok: false, error: "Forbidden" };
        }

        logWithCorrelation(correlationId, "WEBHOOK_RECEIVED", `platform=telegram business_id=${businessId}`);

        const businessAdapter = new TelegramAdapter(business.telegram_bot_token);

        const callbackQueryId =
          typeof (body as { callback_query?: { id?: unknown } })?.callback_query?.id === "string"
            ? ((body as { callback_query?: { id?: string } }).callback_query?.id ?? "")
            : "";

        if (callbackQueryId) {
          if (isDuplicateCallbackQuery(callbackQueryId)) {
            logWithCorrelation(
              correlationId,
              "INCOMING_IGNORED",
              `platform=telegram business_id=${businessId} duplicate callback_query_id=${callbackQueryId}`
            );
            return { ok: true };
          }

          const formattedCallbackMessage = formatTelegramWebhook(body);
          if (!formattedCallbackMessage) {
            logWithCorrelation(correlationId, "INCOMING_IGNORED", `platform=telegram business_id=${businessId} unsupported callback payload`);
            return { ok: true };
          }

          formattedCallbackMessage.request_id = correlationId;
          formattedCallbackMessage.business_id = businessId;

          void (async () => {
            try {
              const ack = await businessAdapter.answerCallbackQuery(callbackQueryId, {
                request_id: correlationId
              });

              if (!ack.success) {
                const ackError = ack.error ?? "unknown error";
                const isExpiredQuery = ackError.toLowerCase().includes("query is too old");
                logWithCorrelation(
                  correlationId,
                  "DOWNSTREAM_ERROR",
                  `platform=telegram business_id=${businessId} answerCallbackQuery failed: ${ackError}`,
                  isExpiredQuery ? "info" : "warn"
                );
              }

              await processTelegramMessageAsync(formattedCallbackMessage, correlationId, businessAdapter);
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : "Internal server error";
              logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=telegram business_id=${businessId} async callback ${errorMessage}`, "error");
            }
          })();

          return { ok: true };
        }

        const formattedMessage = formatTelegramWebhook(body);

        if (!formattedMessage) {
          logWithCorrelation(correlationId, "INCOMING_IGNORED", `platform=telegram business_id=${businessId} unsupported payload`);
          return { ok: true };
        }

        formattedMessage.request_id = correlationId;
        formattedMessage.business_id = businessId;
        logWithCorrelation(
          correlationId,
          "INCOMING_MESSAGE",
          `platform=telegram business_id=${businessId} messenger_id=${formattedMessage.messenger_id} message_id=${String((formattedMessage.metadata as Record<string, unknown>)?.message_id ?? "unknown")}`
        );

        void processTelegramMessageAsync(formattedMessage, correlationId, businessAdapter);

        return { ok: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Internal server error";
        logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=telegram business_id=${businessId} ${errorMessage}`, "error");
        set.status = 500;
        return { ok: false, error: errorMessage };
      }
    },
    {
      body: t.Any(),
      detail: {
        summary: "Multi-tenant Telegram webhook",
        description: "Receives updates from a specific business's Telegram bot.",
        tags: ["Webhooks"]
      }
    }
  );
