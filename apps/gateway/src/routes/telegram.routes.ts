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
import { uploadToStorage } from "../services/StorageService";
import { transcribeAudioFile, uploadVoiceToStorage } from "../services/VoiceService";

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
  correlationId: string
): Promise<void> {
  const mutableMessage = formattedMessage as Record<string, unknown> & {
    _photo_file_id?: string;
    _audio_file_id?: string;
    image_url?: string;
    audio_url?: string;
    message?: string;
    language?: string;
  };

  try {
    // If a photo was attached, download from Telegram and upload to storage
    if (mutableMessage._photo_file_id) {
      try {
        const fileData = await telegramAdapter.downloadFile(mutableMessage._photo_file_id, correlationId);
        if (fileData) {
          const imageUrl = await uploadToStorage(
            fileData.data,
            fileData.filename,
            fileData.mimeType,
            correlationId
          );
          if (imageUrl) {
            mutableMessage.image_url = imageUrl;
            logWithCorrelation(correlationId, "MEDIA_UPLOADED", `platform=telegram image_url=${imageUrl}`);
          } else {
            logWithCorrelation(correlationId, "MEDIA_UPLOAD_SKIPPED", "storage not configured", "warn");
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        logWithCorrelation(correlationId, "MEDIA_PROCESS_FAILED", errorMessage, "error");
      }
      delete mutableMessage._photo_file_id;
    }

    // If a voice/audio was attached, download from Telegram and upload to voice storage
    if (mutableMessage._audio_file_id) {
      try {
        const fileData = await telegramAdapter.downloadFile(mutableMessage._audio_file_id, correlationId);
        if (fileData) {
          try {
            const sttResult = await transcribeAudioFile(
              fileData.data,
              fileData.filename,
              fileData.mimeType,
              correlationId
            );
            if (sttResult?.text) {
              mutableMessage.message = sttResult.text;
              if (!mutableMessage.language) {
                mutableMessage.language = sttResult.language;
              }
              logWithCorrelation(
                correlationId,
                "VOICE_STT",
                `platform=telegram transcription="${sttResult.text}" lang=${sttResult.language}`
              );
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            logWithCorrelation(correlationId, "VOICE_STT_ERROR", `platform=telegram ${errorMessage}`, "error");
          }

          const audioUrl = await uploadVoiceToStorage(
            fileData.data,
            fileData.filename,
            fileData.mimeType,
            correlationId
          );
          if (audioUrl) {
            mutableMessage.audio_url = audioUrl;
            logWithCorrelation(correlationId, "MEDIA_UPLOADED", `platform=telegram audio_url=${audioUrl}`);
          } else {
            logWithCorrelation(correlationId, "MEDIA_UPLOAD_SKIPPED", "voice storage not configured", "warn");
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        logWithCorrelation(correlationId, "MEDIA_PROCESS_FAILED", `voice: ${errorMessage}`, "error");
      }
      delete mutableMessage._audio_file_id;
    }

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
  }));
