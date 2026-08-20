
import { Elysia, t } from "elysia";
import {
  CORRELATION_ID_HEADER,
  correlationIdMiddleware,
  generateCorrelationId,
  logWithCorrelation
} from "../middleware/correlationId";
import { messageOrchestrator } from "../services/MessageOrchestrator";
import { formatEvolutionWebhook, EvolutionAdapter } from "../platforms/EvolutionAdapter";
import {
  transcribeVoice,
  describeCustomerImage,
  photoMessageText,
  voiceMessageText
} from "../services/MediaUnderstanding";
import { getBusinessById } from "../services/BusinessRegistry";

type OrchestratorInput = Parameters<typeof messageOrchestrator.processIncomingMessage>[0];

const EVOLUTION_MESSAGE_TTL_MS = 10 * 60 * 1000;
const seenEvolutionMessageIds = new Map<string, number>();

function isDuplicateEvolutionMessage(messageId: string): boolean {
  const now = Date.now();

  for (const [id, seenAt] of seenEvolutionMessageIds.entries()) {
    if (now - seenAt > EVOLUTION_MESSAGE_TTL_MS) {
      seenEvolutionMessageIds.delete(id);
    }
  }

  const existing = seenEvolutionMessageIds.get(messageId);
  if (existing && now - existing <= EVOLUTION_MESSAGE_TTL_MS) {
    return true;
  }

  seenEvolutionMessageIds.set(messageId, now);
  return false;
}

/** Resolve an inbound WhatsApp photo or voice note to text for the orchestrator. */
async function resolveEvolutionMedia(
  message: Record<string, unknown> & {
    _media_kind?: string;
    _media_id?: string;
    _caption?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  },
  business: { id: string; sector?: string | null; whatsapp_instance_name?: string | null },
  correlationId: string
): Promise<void> {
  const kind = message._media_kind;
  const mediaId = message._media_id;

  if (kind && mediaId) {
    const adapter = new EvolutionAdapter(
      business.whatsapp_instance_name ?? business.id,
      process.env.EVOLUTION_API_KEY ?? ""
    );
    const file = await adapter.downloadMedia(mediaId, correlationId);

    if (kind === "photo") {
      const understanding = file
        ? await describeCustomerImage(file.data, file.mimeType, business.sector ?? undefined)
        : null;
      message.message = photoMessageText(understanding, message._caption);
      message.metadata = { ...(message.metadata ?? {}), type: "photo" };
      logWithCorrelation(
        correlationId,
        understanding ? "MEDIA_UNDERSTOOD" : "MEDIA_UNREADABLE",
        `platform=whatsapp kind=photo description="${understanding?.description ?? "-"}"`,
        understanding ? "log" : "warn"
      );
    } else if (kind === "voice") {
      const transcript = file ? await transcribeVoice(file.data, file.mimeType) : null;
      message.message = voiceMessageText(transcript, message._caption);
      message.metadata = { ...(message.metadata ?? {}), type: "voice" };
      logWithCorrelation(
        correlationId,
        transcript ? "VOICE_TRANSCRIBED" : "VOICE_UNREADABLE",
        `platform=whatsapp transcript="${transcript?.slice(0, 80) ?? "-"}"`,
        transcript ? "log" : "warn"
      );
    }
  }

  delete message._media_kind;
  delete message._media_id;
  delete message._caption;
}

async function processEvolutionMessageAsync(
  incomingMessage: OrchestratorInput,
  correlationId: string
): Promise<void> {
  try {
    const result = await messageOrchestrator.processIncomingMessage(incomingMessage);
    if (!result.success) {
      logWithCorrelation(
        correlationId,
        "ROUTING_ERROR",
        `platform=whatsapp(evolution) orchestrator failed: ${result.error ?? "unknown error"}`,
        "error"
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=whatsapp(evolution) async ${errorMessage}`, "error");
  }
}

export const evolutionRoutes = new Elysia({ prefix: "/webhook" })
  .use(correlationIdMiddleware)
  .post(
    "/evolution/:business_id",
    async (context) => {
      const { body, set, params } = context;
      const correlationId =
        (context as { correlationId?: string }).correlationId ?? generateCorrelationId();
      set.headers[CORRELATION_ID_HEADER] = correlationId;
      const businessId = params.business_id;

      try {
        const business = await getBusinessById(businessId);
        if (!business || !business.whatsapp_instance_name) {
          logWithCorrelation(
            correlationId,
            "WEBHOOK_AUTH_FAILED",
            `platform=whatsapp(evolution) business_id=${businessId} not registered for WhatsApp`,
            "warn"
          );
          set.status = 404;
          return { ok: false, error: "Business not found or WhatsApp not connected" };
        }

        const payloadInstance =
          typeof (body as { instance?: unknown })?.instance === "string"
            ? (body as { instance: string }).instance
            : "";

        if (payloadInstance && payloadInstance !== business.whatsapp_instance_name) {
          logWithCorrelation(
            correlationId,
            "WEBHOOK_AUTH_FAILED",
            `platform=whatsapp(evolution) business_id=${businessId} instance mismatch (payload=${payloadInstance})`,
            "warn"
          );
          set.status = 403;
          return { ok: false, error: "Instance mismatch" };
        }

        logWithCorrelation(correlationId, "WEBHOOK_RECEIVED", `platform=whatsapp(evolution) business_id=${businessId}`);

        const formattedMessage = formatEvolutionWebhook(body);
        if (!formattedMessage) {
          logWithCorrelation(correlationId, "INCOMING_IGNORED", `platform=whatsapp(evolution) business_id=${businessId} unsupported/group/self payload`);
          return { ok: true };
        }

        const messageId = String((formattedMessage.metadata as Record<string, unknown>)?.message_id ?? "");
        if (messageId && isDuplicateEvolutionMessage(messageId)) {
          logWithCorrelation(
            correlationId,
            "INCOMING_IGNORED",
            `platform=whatsapp(evolution) business_id=${businessId} duplicate message_id=${messageId}`
          );
          return { ok: true };
        }

        formattedMessage.request_id = correlationId;
        formattedMessage.business_id = businessId;
        logWithCorrelation(
          correlationId,
          "INCOMING_MESSAGE",
          `platform=whatsapp(evolution) business_id=${businessId} messenger_id=${formattedMessage.messenger_id} message_id=${messageId || "unknown"}`
        );

        void resolveEvolutionMedia(formattedMessage, business, correlationId)
          .catch((err) =>
            logWithCorrelation(
              correlationId,
              "MEDIA_PROCESS_FAILED",
              `platform=whatsapp ${err instanceof Error ? err.message : String(err)}`,
              "error"
            )
          )
          .finally(() =>
            processEvolutionMessageAsync(formattedMessage as unknown as OrchestratorInput, correlationId)
          );

        return { ok: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Internal server error";
        logWithCorrelation(correlationId, "WEBHOOK_ERROR", `platform=whatsapp(evolution) business_id=${businessId} ${errorMessage}`, "error");
        set.status = 500;
        return { ok: false, error: errorMessage };
      }
    },
    {
      body: t.Any(),
      detail: {
        summary: "Evolution API (WhatsApp) webhook",
        description: "Receives events from a specific business's Evolution API instance.",
        tags: ["Webhooks"]
      }
    }
  )

  .get("/evolution/:business_id", ({ params }) => ({
    status: `Evolution webhook is active for business ${params.business_id}`,
    timestamp: new Date().toISOString()
  }));
