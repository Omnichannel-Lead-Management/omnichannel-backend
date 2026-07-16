import type { IncomingMessage, PlatformAdapter, PlatformCapabilities } from "./PlatformAdapter";
import { CORRELATION_ID_HEADER, extractRequestId, generateCorrelationId } from "../middleware/correlationId";

/**
 * EvolutionAdapter
 *
 * Sends/receives WhatsApp messages via a self-hosted Evolution API instance
 * (Baileys/WhatsApp-Web protocol — see /evolution-api at the repo root).
 *
 * Unlike TelegramAdapter/WhatsAppAdapter (Meta Cloud API), this adapter is always
 * constructed per-business: one Evolution "instance" == one vendor's WhatsApp number.
 *
 * NOTE: sendInteractive is deliberately NOT implemented. Baileys' button/list
 * messages are unreliable on current WhatsApp client versions (WhatsApp has been
 * restricting rich interactive messages to verified Business API senders) — the
 * orchestrator already falls back to plain text when sendInteractive is absent.
 */
export class EvolutionAdapter implements PlatformAdapter {
  readonly name = "whatsapp";

  readonly capabilities: PlatformCapabilities = {
    quick_replies: false,
    url_buttons: false,
    lists: false,
    max_quick_replies: null
  };

  private readonly apiUrl: string;
  private readonly instanceName: string;
  private readonly apiKey: string;

  constructor(instanceName: string, apiKey: string, apiUrl?: string) {
    this.instanceName = instanceName;
    this.apiKey = apiKey;
    this.apiUrl = (apiUrl || process.env.EVOLUTION_API_URL || "http://localhost:8080").replace(/\/$/, "");
  }

  private toPhoneNumber(messenger_id: string): string {
    return messenger_id.replace(/^wa_/, "");
  }

  async sendMessage(
    messenger_id: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    const requestId = extractRequestId(metadata) ?? generateCorrelationId();

    try {
      const response = await fetch(`${this.apiUrl}/message/sendText/${this.instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.apiKey,
          [CORRELATION_ID_HEADER]: requestId
        },
        body: JSON.stringify({
          number: this.toPhoneNumber(messenger_id),
          text: message
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Evolution API returned ${response.status}: ${detail}`);
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Failed to send Evolution message (instance=${this.instanceName}):`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  async sendPhoto(
    messenger_id: string,
    url: string,
    caption?: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    const requestId = extractRequestId(metadata) ?? generateCorrelationId();

    try {
      const response = await fetch(`${this.apiUrl}/message/sendMedia/${this.instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.apiKey,
          [CORRELATION_ID_HEADER]: requestId
        },
        body: JSON.stringify({
          number: this.toPhoneNumber(messenger_id),
          mediatype: "image",
          media: url,
          ...(caption ? { caption } : {})
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Evolution API returned ${response.status}: ${detail}`);
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Failed to send Evolution photo (instance=${this.instanceName}):`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  async sendAudio(
    messenger_id: string,
    url: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    const requestId = extractRequestId(metadata) ?? generateCorrelationId();

    try {
      const response = await fetch(`${this.apiUrl}/message/sendWhatsAppAudio/${this.instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.apiKey,
          [CORRELATION_ID_HEADER]: requestId
        },
        body: JSON.stringify({
          number: this.toPhoneNumber(messenger_id),
          audio: url
        })
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Evolution API returned ${response.status}: ${detail}`);
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Failed to send Evolution audio (instance=${this.instanceName}):`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  validateMessengerId(messenger_id: string): boolean {
    return /^wa_\d+$/.test(messenger_id);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractJidNumber(jid: string): string {
  return jid.replace(/@.*/, "").replace(/\D/g, "");
}

/**
 * Parse an Evolution API webhook event into the standard IncomingMessage shape.
 * Returns null for anything that isn't a processable direct-chat text/media message
 * (group messages, status/delivery-ack-only events, self-sent echoes, etc. are skipped).
 */
export function formatEvolutionWebhook(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;

  const event = typeof payload.event === "string" ? payload.event : "";
  if (event.toLowerCase() !== "messages.upsert") return null;

  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return null;

  const key = isRecord(data.key) ? data.key : null;
  if (!key) return null;

  // Skip messages the connected account sent itself (already visible in the vendor's own app).
  if (key.fromMe === true) return null;

  // Prefer the phone-number JID when WhatsApp's newer LID addressing is in play.
  const remoteJidAlt = typeof key.remoteJidAlt === "string" ? key.remoteJidAlt : "";
  const remoteJid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  const resolvedJid = remoteJidAlt.endsWith("@s.whatsapp.net") ? remoteJidAlt : remoteJid;

  // Only handle direct 1:1 chats — skip group messages (@g.us), broadcast lists, etc.
  if (!resolvedJid.endsWith("@s.whatsapp.net")) return null;

  const phone = extractJidNumber(resolvedJid);
  if (!phone) return null;

  const message = isRecord(data.message) ? data.message : null;
  if (!message) return null;

  let messageText = "";
  if (typeof message.conversation === "string") {
    messageText = message.conversation;
  } else if (isRecord(message.extendedTextMessage) && typeof message.extendedTextMessage.text === "string") {
    messageText = message.extendedTextMessage.text;
  } else if (isRecord(message.imageMessage)) {
    messageText =
      typeof message.imageMessage.caption === "string" && message.imageMessage.caption
        ? message.imageMessage.caption
        : "[image]";
  } else if (isRecord(message.audioMessage)) {
    messageText = "[Voice Message]";
  }

  if (!messageText) return null;

  const pushName = typeof data.pushName === "string" ? data.pushName : undefined;
  const messageId = typeof key.id === "string" ? key.id : "";
  const timestamp = typeof data.messageTimestamp === "number" ? data.messageTimestamp : Date.now() / 1000;

  return {
    platform: "whatsapp",
    messenger_id: `wa_${phone}`,
    message: messageText,
    first_name: pushName,
    phone,
    metadata: {
      from: phone,
      message_id: messageId,
      timestamp,
      type: isRecord(message.imageMessage) ? "image" : isRecord(message.audioMessage) ? "audio" : "text",
      instance: typeof payload.instance === "string" ? payload.instance : undefined
    }
  };
}
