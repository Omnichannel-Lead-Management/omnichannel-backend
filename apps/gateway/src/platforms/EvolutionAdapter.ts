import type { IncomingMessage, PlatformAdapter, PlatformCapabilities } from "./PlatformAdapter";
import { CORRELATION_ID_HEADER, extractRequestId, generateCorrelationId } from "../middleware/correlationId";

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

  /** Fetch the bytes of an inbound media message. */
  async downloadMedia(
    messageId: string,
    requestId?: string
  ): Promise<{ data: Uint8Array; mimeType: string } | null> {
    try {
      const response = await fetch(
        `${this.apiUrl}/chat/getBase64FromMediaMessage/${this.instanceName}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: this.apiKey,
            ...(requestId ? { [CORRELATION_ID_HEADER]: requestId } : {})
          },
          body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false })
        }
      );

      if (!response.ok) {
        console.warn(`[evolution] downloadMedia ${messageId} failed: HTTP ${response.status}`);
        return null;
      }

      const body = (await response.json()) as { base64?: string; mimetype?: string };
      if (!body.base64) return null;

      return {
        data: new Uint8Array(Buffer.from(body.base64, "base64")),
        mimeType: body.mimetype || "application/octet-stream"
      };
    } catch (err) {
      console.warn(
        `[evolution] downloadMedia ${messageId} error:`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
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

/** Parse an Evolution API webhook event into the standard IncomingMessage shape. */
export function formatEvolutionWebhook(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;

  const event = typeof payload.event === "string" ? payload.event : "";
  if (event.toLowerCase() !== "messages.upsert") return null;

  const data = isRecord(payload.data) ? payload.data : null;
  if (!data) return null;

  const key = isRecord(data.key) ? data.key : null;
  if (!key) return null;

  if (key.fromMe === true) return null;

  const remoteJidAlt = typeof key.remoteJidAlt === "string" ? key.remoteJidAlt : "";
  const remoteJid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  const resolvedJid = remoteJidAlt.endsWith("@s.whatsapp.net") ? remoteJidAlt : remoteJid;

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
        : "[Photo]";
  } else if (isRecord(message.audioMessage)) {
    messageText = "[Voice Message]";
  }

  if (!messageText) return null;

  const pushName = typeof data.pushName === "string" ? data.pushName : undefined;
  const messageId = typeof key.id === "string" ? key.id : "";
  const timestamp = typeof data.messageTimestamp === "number" ? data.messageTimestamp : Date.now() / 1000;

  const mediaKind = isRecord(message.imageMessage)
    ? "photo"
    : isRecord(message.audioMessage)
      ? "voice"
      : null;
  const caption =
    isRecord(message.imageMessage) && typeof message.imageMessage.caption === "string"
      ? message.imageMessage.caption
      : "";

  return {
    platform: "whatsapp",
    messenger_id: `wa_${phone}`,
    message: messageText,
    first_name: pushName,
    phone,
    ...(mediaKind ? { _media_kind: mediaKind, _media_id: messageId, _caption: caption } : {}),
    metadata: {
      from: phone,
      message_id: messageId,
      timestamp,
      type: isRecord(message.imageMessage) ? "image" : isRecord(message.audioMessage) ? "audio" : "text",
      instance: typeof payload.instance === "string" ? payload.instance : undefined
    }
  };
}
