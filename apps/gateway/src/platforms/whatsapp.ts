import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import {
  CORRELATION_ID_HEADER,
  extractRequestId,
  generateCorrelationId,
  logWithCorrelation
} from "../middleware/correlationId";
import type { AgentMessage, IncomingMessage, PlatformAdapter, PlatformCapabilities } from "./PlatformAdapter";
import { uploadToStorage } from "../services/StorageService";
import { transcribeAudioFile, uploadVoiceToStorage } from "../services/VoiceService";

const META_API_VERSION = "v22.0";
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
const RETRY_DELAY_MS = 2000;
const NOTIFICATION_THROTTLE_WINDOW_MS = 60 * 60 * 1000;

type SendResult = { success: boolean; error?: string };

interface DispatchOptions {
  applyNotificationThrottle: boolean;
  requestId?: string;
}

interface WhatsAppMediaLookupResponse {
  url?: string;
}

interface WhatsAppApiErrorResponse {
  error?: {
    message?: string;
  };
}

export interface WhatsAppTemplateComponent {
  type: "header" | "body" | "button";
  parameters?: Array<Record<string, unknown>>;
  sub_type?: string;
  index?: string;
}

export interface WhatsAppStatusEvent {
  id?: string;
  status?: string;
  recipient_id?: string;
  timestamp?: string;
}

export interface WhatsAppWebhookParseResult {
  messages: IncomingMessage[];
  statuses: WhatsAppStatusEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, "");
}

function extractRecipient(value: string): string {
  if (value.startsWith("wa_")) {
    return normalizePhoneNumber(value.slice(3));
  }

  return normalizePhoneNumber(value);
}

function getWhatsAppToken(): string {
  return process.env.WHATSAPP_TOKEN?.trim() ?? "";
}

function getWhatsAppPhoneNumberId(): string {
  return process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
}

function parseMetaError(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as WhatsAppApiErrorResponse;
    if (parsed.error?.message) {
      return parsed.error.message;
    }
    return raw;
  } catch {
    return raw;
  }
}

function normalizeInteractiveText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildUniqueInteractiveId(
  preferred: string,
  fallback: string,
  usedIds: Set<string>,
  maxLength: number
): string {
  const normalizedPreferred = normalizeInteractiveText(preferred, maxLength);
  const normalizedFallback = normalizeInteractiveText(fallback, maxLength);
  let candidate = normalizedPreferred || normalizedFallback || `id_${usedIds.size + 1}`;

  if (!usedIds.has(candidate)) {
    usedIds.add(candidate);
    return candidate;
  }

  const base = candidate.slice(0, Math.max(1, maxLength - 4));
  let suffix = 2;
  while (true) {
    const withSuffix = `${base}_${suffix}`.slice(0, maxLength);
    if (!usedIds.has(withSuffix)) {
      usedIds.add(withSuffix);
      return withSuffix;
    }
    suffix += 1;
  }
}

function resolveInteractiveSelectionText(
  visibleText: string,
  internalValue: string
): string {
  const normalizedValue = internalValue.trim();
  if (normalizedValue.toLowerCase().startsWith("__lang_")) {
    return normalizedValue;
  }

  return visibleText || normalizedValue;
}

async function evaluateNotificationThrottle(recipient: string): Promise<{ throttled: boolean; retryAfterSeconds?: number }> {
  const row = await db
    .select()
    .from(schema.whatsappMessageThrottle)
    .where(eq(schema.whatsappMessageThrottle.recipient, recipient))
    .then((rows) => rows[0]);

  if (!row) {
    return { throttled: false };
  }

  const lastSentMs = Date.parse(row.last_sent_at);
  if (Number.isNaN(lastSentMs)) {
    return { throttled: false };
  }

  const elapsedMs = Date.now() - lastSentMs;
  if (elapsedMs >= NOTIFICATION_THROTTLE_WINDOW_MS) {
    return { throttled: false };
  }

  const retryAfterSeconds = Math.ceil((NOTIFICATION_THROTTLE_WINDOW_MS - elapsedMs) / 1000);
  return { throttled: true, retryAfterSeconds };
}

async function recordNotificationSent(recipient: string): Promise<void> {
  const now = new Date().toISOString();

  await db.execute(sql`
    INSERT INTO whatsapp_message_throttle (recipient, last_sent_at, updated_at)
    VALUES (${recipient}, ${now}, ${now})
    ON CONFLICT(recipient) DO UPDATE SET
      last_sent_at = excluded.last_sent_at,
      updated_at = excluded.updated_at
  `);
}

async function callMetaMessagesApi(
  payload: Record<string, unknown>,
  requestId: string
): Promise<SendResult> {
  const token = getWhatsAppToken();
  const phoneNumberId = getWhatsAppPhoneNumberId();

  if (!token) {
    return { success: false, error: "WHATSAPP_TOKEN is not configured" };
  }

  if (!phoneNumberId) {
    return { success: false, error: "WHATSAPP_PHONE_NUMBER_ID is not configured" };
  }

  const url = `${META_GRAPH_BASE_URL}/${phoneNumberId}/messages`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          [CORRELATION_ID_HEADER]: requestId
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        return { success: true };
      }

      const responseText = await response.text();
      const parsedError = parseMetaError(responseText);
      logWithCorrelation(
        requestId,
        "DOWNSTREAM_ERROR",
        `platform=whatsapp status=${response.status} attempt=${attempt}/2 detail="${parsedError}"`,
        "error"
      );

      if (attempt < 2) {
        await Bun.sleep(RETRY_DELAY_MS);
        continue;
      }

      return {
        success: false,
        error: `[REQ-${requestId}] Meta API returned ${response.status}: ${parsedError}`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logWithCorrelation(
        requestId,
        "DOWNSTREAM_ERROR",
        `platform=whatsapp network attempt=${attempt}/2 detail="${errorMessage}"`,
        "error"
      );

      if (attempt < 2) {
        await Bun.sleep(RETRY_DELAY_MS);
        continue;
      }

      return {
        success: false,
        error: `[REQ-${requestId}] Failed to call Meta API: ${errorMessage}`
      };
    }
  }

  return {
    success: false,
    error: `[REQ-${requestId}] Meta API request failed after retries`
  };
}

async function dispatchMessageToRecipient(
  to: string,
  payload: Record<string, unknown>,
  options: DispatchOptions
): Promise<SendResult> {
  const requestId = options.requestId ?? generateCorrelationId();
  const recipient = extractRecipient(to);
  if (!recipient) {
    return { success: false, error: "Invalid recipient phone number" };
  }

  if (options.applyNotificationThrottle) {
    const throttleState = await evaluateNotificationThrottle(recipient);
    if (throttleState.throttled) {
      return {
        success: false,
        error: `Notification throttled for ${recipient}. Retry after ${throttleState.retryAfterSeconds ?? 0}s`
      };
    }
  }

  const result = await callMetaMessagesApi(
    {
      messaging_product: "whatsapp",
      to: recipient,
      ...payload
    },
    requestId
  );

  if (!result.success) {
    return result;
  }

  if (options.applyNotificationThrottle) {
    await recordNotificationSent(recipient);
  }

  return { success: true };
}

async function sendTextPayload(to: string, text: string, options: DispatchOptions): Promise<SendResult> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return { success: false, error: "Message text cannot be empty" };
  }

  return dispatchMessageToRecipient(
    to,
    {
      type: "text",
      text: { body: trimmedText, preview_url: false }
    },
    options
  );
}

async function sendImagePayload(
  to: string,
  imageUrl: string,
  caption: string | undefined,
  options: DispatchOptions
): Promise<SendResult> {
  const trimmedUrl = imageUrl.trim();
  if (!trimmedUrl) {
    return { success: false, error: "Image URL cannot be empty" };
  }

  const imageBody: Record<string, unknown> = { link: trimmedUrl };
  if (caption?.trim()) {
    imageBody.caption = caption.trim();
  }

  return dispatchMessageToRecipient(
    to,
    {
      type: "image",
      image: imageBody
    },
    options
  );
}

function inferFilenameFromMediaUrl(mediaUrl: string, fallbackExt: string = "bin"): string {
  try {
    const parsed = new URL(mediaUrl);
    const base = parsed.pathname.split("/").pop()?.trim();
    if (base) {
      return base;
    }
  } catch {
    // URL may be relative/invalid; use fallback filename below.
  }
  return `audio_${Date.now()}.${fallbackExt}`;
}

function extensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "audio/ogg") return "ogg";
  if (normalized === "audio/mp4") return "m4a";
  if (normalized === "audio/aac") return "aac";
  if (normalized === "audio/amr") return "amr";
  if (normalized === "audio/wav") return "wav";
  return "bin";
}

async function uploadWhatsAppMediaFromUrl(
  mediaUrl: string,
  requestId: string
): Promise<{ success: true; mediaId: string } | { success: false; error: string }> {
  const token = getWhatsAppToken();
  const phoneNumberId = getWhatsAppPhoneNumberId();

  if (!token) {
    return { success: false, error: "WHATSAPP_TOKEN is not configured" };
  }

  if (!phoneNumberId) {
    return { success: false, error: "WHATSAPP_PHONE_NUMBER_ID is not configured" };
  }

  const sourceResponse = await fetch(mediaUrl, {
    headers: { [CORRELATION_ID_HEADER]: requestId }
  });
  if (!sourceResponse.ok) {
    return {
      success: false,
      error: `Failed to download source audio URL (${sourceResponse.status})`
    };
  }

  const mimeType =
    sourceResponse.headers.get("content-type")?.split(";")[0].trim() ??
    "application/octet-stream";
  const fallbackExt = extensionFromMimeType(mimeType);
  const filename = inferFilenameFromMediaUrl(mediaUrl, fallbackExt);
  const data = new Uint8Array(await sourceResponse.arrayBuffer());

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([data], { type: mimeType }), filename);

  const uploadResponse = await fetch(`${META_GRAPH_BASE_URL}/${phoneNumberId}/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      [CORRELATION_ID_HEADER]: requestId
    },
    body: form
  });

  const raw = await uploadResponse.text();
  let parsed: { id?: string } & WhatsAppApiErrorResponse = {};
  try {
    parsed = JSON.parse(raw) as { id?: string } & WhatsAppApiErrorResponse;
  } catch {
    parsed = {};
  }

  if (!uploadResponse.ok || typeof parsed.id !== "string" || !parsed.id.trim()) {
    const detail = parseMetaError(raw);
    return {
      success: false,
      error: `Media upload failed (${uploadResponse.status}): ${detail}`
    };
  }

  return { success: true, mediaId: parsed.id.trim() };
}

export async function sendWhatsAppMessage(
  to: string,
  text: string,
  requestId?: string
): Promise<SendResult> {
  return sendTextPayload(to, text, {
    applyNotificationThrottle: true,
    requestId
  });
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  components: WhatsAppTemplateComponent[] = [],
  requestId?: string
): Promise<SendResult> {
  const trimmedTemplateName = templateName.trim();
  if (!trimmedTemplateName) {
    return { success: false, error: "Template name cannot be empty" };
  }

  const languageCode = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en_US";

  return dispatchMessageToRecipient(
    to,
    {
      type: "template",
      template: {
        name: trimmedTemplateName,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {})
      }
    },
    {
      applyNotificationThrottle: true,
      requestId
    }
  );
}

async function resolveWhatsAppMediaUrl(mediaId: string, requestId: string): Promise<string | null> {
  const token = getWhatsAppToken();
  if (!token) {
    return null;
  }

  const url = `${META_GRAPH_BASE_URL}/${mediaId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      [CORRELATION_ID_HEADER]: requestId
    }
  });

  if (!response.ok) {
    const body = await response.text();
    logWithCorrelation(
      requestId,
      "DOWNSTREAM_ERROR",
      `platform=whatsapp media_lookup media_id=${mediaId} status=${response.status} detail="${parseMetaError(body)}"`,
      "error"
    );
    return null;
  }

  const json = await response.json() as WhatsAppMediaLookupResponse;
  return typeof json.url === "string" ? json.url : null;
}

async function downloadWhatsAppMedia(
  mediaUrl: string,
  requestId: string
): Promise<{ data: Uint8Array; filename: string; mimeType: string } | null> {
  const token = getWhatsAppToken();
  if (!token) {
    return null;
  }

  const response = await fetch(mediaUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      [CORRELATION_ID_HEADER]: requestId
    }
  });

  if (!response.ok) {
    logWithCorrelation(
      requestId,
      "DOWNSTREAM_ERROR",
      `platform=whatsapp media_download status=${response.status}`,
      "error"
    );
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const mimeType = contentType.split(";")[0].trim();
  const ext = mimeType.split("/")[1] ?? "jpg";
  const filename = `wa_media_${Date.now()}.${ext}`;
  const buffer = await response.arrayBuffer();
  return { data: new Uint8Array(buffer), filename, mimeType };
}

function getContactNameByPhone(value: Record<string, unknown>): Map<string, string> {
  const namesByPhone = new Map<string, string>();

  const contacts = value.contacts;
  if (!Array.isArray(contacts)) {
    return namesByPhone;
  }

  for (const contact of contacts) {
    if (!isRecord(contact)) {
      continue;
    }

    const waIdRaw = contact.wa_id;
    const waId = typeof waIdRaw === "string" ? normalizePhoneNumber(waIdRaw) : "";
    if (!waId) {
      continue;
    }

    const profile = isRecord(contact.profile) ? contact.profile : null;
    const name = profile && typeof profile.name === "string" ? profile.name.trim() : "";
    if (!name) {
      continue;
    }

    namesByPhone.set(waId, name);
  }

  return namesByPhone;
}

export async function formatWhatsAppWebhook(
  payload: unknown,
  requestId: string = generateCorrelationId()
): Promise<WhatsAppWebhookParseResult> {
  const messages: IncomingMessage[] = [];
  const statuses: WhatsAppStatusEvent[] = [];

  if (!isRecord(payload)) {
    return { messages, statuses };
  }

  const entries = payload.entry;
  if (!Array.isArray(entries)) {
    return { messages, statuses };
  }

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const changes = entry.changes;
    if (!Array.isArray(changes)) {
      continue;
    }

    for (const change of changes) {
      if (!isRecord(change)) {
        continue;
      }

      const value = isRecord(change.value) ? change.value : null;
      if (!value) {
        continue;
      }

      const contactNames = getContactNameByPhone(value);

      const statusList = value.statuses;
      if (Array.isArray(statusList)) {
        for (const statusItem of statusList) {
          if (!isRecord(statusItem)) {
            continue;
          }

          statuses.push({
            id: typeof statusItem.id === "string" ? statusItem.id : undefined,
            status: typeof statusItem.status === "string" ? statusItem.status : undefined,
            recipient_id:
              typeof statusItem.recipient_id === "string"
                ? normalizePhoneNumber(statusItem.recipient_id)
                : undefined,
            timestamp: typeof statusItem.timestamp === "string" ? statusItem.timestamp : undefined
          });
        }
      }

      const incomingMessages = value.messages;
      if (!Array.isArray(incomingMessages)) {
        continue;
      }

      for (const incoming of incomingMessages) {
        if (!isRecord(incoming)) {
          continue;
        }

        const fromRaw = incoming.from;
        const from = typeof fromRaw === "string" ? normalizePhoneNumber(fromRaw) : "";
        if (!from) {
          continue;
        }

        const type = typeof incoming.type === "string" ? incoming.type : "";
        const messageId = typeof incoming.id === "string" ? incoming.id : "";
        const timestamp =
          typeof incoming.timestamp === "string" ? incoming.timestamp : new Date().toISOString();
        const profileName = contactNames.get(from);

        // Look up the original message when the user replied to one
        let repliedTo: { text: string; is_from_user: boolean } | undefined;
        if (isRecord(incoming.context)) {
          const replyToId = typeof incoming.context.id === "string" ? incoming.context.id : "";
          if (replyToId) {
            const original = await db
              .select()
              .from(schema.chatMessages)
              .where(
                and(
                  eq(schema.chatMessages.platform, "whatsapp"),
                  eq(schema.chatMessages.messenger_id, `wa_${from}`),
                  sql`(${schema.chatMessages.metadata}::json ->> 'message_id') = ${replyToId}`
                )
              )
              .then((rows) => rows[0]);
            if (original) {
              repliedTo = {
                text: original.message_text,
                is_from_user: Boolean(original.is_from_user)
              };
            }
          }
        }

        if (type === "text") {
          const textPayload = isRecord(incoming.text) ? incoming.text : null;
          const textBody =
            textPayload && typeof textPayload.body === "string" ? textPayload.body.trim() : "";

          if (!textBody) {
            continue;
          }

          messages.push({
            platform: "whatsapp",
            messenger_id: `wa_${from}`,
            message: textBody,
            first_name: profileName,
            phone: from,
            metadata: {
              from,
              message_id: messageId,
              timestamp,
              type: "text"
            },
            replied_to: repliedTo
          });
          continue;
        }

        if (type === "interactive") {
          const interactivePayload = isRecord(incoming.interactive) ? incoming.interactive : null;
          if (!interactivePayload) {
            continue;
          }

          const interactiveType =
            typeof interactivePayload.type === "string" ? interactivePayload.type : "";

          let interactiveText = "";
          let interactiveValue = "";

          if (interactiveType === "button_reply") {
            const reply = isRecord(interactivePayload.button_reply)
              ? interactivePayload.button_reply
              : null;
            if (reply) {
              interactiveText = typeof reply.title === "string" ? reply.title.trim() : "";
              interactiveValue = typeof reply.id === "string" ? reply.id.trim() : "";
            }
          } else if (interactiveType === "list_reply") {
            const reply = isRecord(interactivePayload.list_reply)
              ? interactivePayload.list_reply
              : null;
            if (reply) {
              interactiveText = typeof reply.title === "string" ? reply.title.trim() : "";
              interactiveValue = typeof reply.id === "string" ? reply.id.trim() : "";
            }
          }

          const messageText = resolveInteractiveSelectionText(interactiveText, interactiveValue);
          if (!messageText) {
            continue;
          }

          messages.push({
            platform: "whatsapp",
            messenger_id: `wa_${from}`,
            message: messageText,
            first_name: profileName,
            phone: from,
            metadata: {
              from,
              message_id: messageId,
              timestamp,
              type: "interactive",
              interactive_type: interactiveType || null,
              interactive_value: interactiveValue || null
            },
            replied_to: repliedTo
          });
          continue;
        }

        if (type === "button") {
          const buttonPayload = isRecord(incoming.button) ? incoming.button : null;
          if (!buttonPayload) {
            continue;
          }

          const buttonVisibleText =
            typeof buttonPayload.text === "string" ? buttonPayload.text.trim() : "";
          const buttonPayloadValue =
            typeof buttonPayload.payload === "string" ? buttonPayload.payload.trim() : "";
          const buttonText = resolveInteractiveSelectionText(buttonVisibleText, buttonPayloadValue);

          if (!buttonText) {
            continue;
          }

          messages.push({
            platform: "whatsapp",
            messenger_id: `wa_${from}`,
            message: buttonText,
            first_name: profileName,
            phone: from,
            metadata: {
              from,
              message_id: messageId,
              timestamp,
              type: "button"
            },
            replied_to: repliedTo
          });
          continue;
        }

        if (type === "image") {
          const imagePayload = isRecord(incoming.image) ? incoming.image : null;
          if (!imagePayload) {
            continue;
          }

          const mediaId = typeof imagePayload.id === "string" ? imagePayload.id : "";
          let rawMediaUrl = "";

          if (typeof imagePayload.link === "string") {
            rawMediaUrl = imagePayload.link;
          } else if (typeof imagePayload.url === "string") {
            rawMediaUrl = imagePayload.url;
          } else if (mediaId) {
            rawMediaUrl = (await resolveWhatsAppMediaUrl(mediaId, requestId)) ?? "";
          }

          let imageUrl = rawMediaUrl;

          if (rawMediaUrl) {
            try {
              const fileData = await downloadWhatsAppMedia(rawMediaUrl, requestId);
              if (fileData) {
                const storedUrl = await uploadToStorage(
                  fileData.data,
                  fileData.filename,
                  fileData.mimeType,
                  requestId
                );
                if (storedUrl) {
                  imageUrl = storedUrl;
                }
              }
            } catch (err) {
              logWithCorrelation(
                requestId,
                "STORAGE_ERROR",
                `platform=whatsapp media upload failed: ${err instanceof Error ? err.message : String(err)}`,
                "error"
              );
            }
          }

          const imageCaption =
            typeof imagePayload.caption === "string" ? imagePayload.caption.trim() : "";

          // Route image URL through the same text-based orchestration pipeline.
          const messageText = imageUrl || imageCaption || "[image]";

          messages.push({
            platform: "whatsapp",
            messenger_id: `wa_${from}`,
            message: messageText,
            first_name: profileName,
            phone: from,
            metadata: {
              from,
              message_id: messageId,
              timestamp,
              type: "image",
              image_url: imageUrl || null,
              image_caption: imageCaption || null,
              media_id: mediaId || null
            },
            replied_to: repliedTo
          });
          continue;
        }

        if (type === "audio" || type === "voice") {
          const voicePayloadRaw = (incoming as Record<string, unknown>).voice;
          const audioPayload = isRecord(incoming.audio)
            ? incoming.audio
            : isRecord(voicePayloadRaw)
              ? voicePayloadRaw
              : null;
          if (!audioPayload) {
            continue;
          }

          const mediaId = typeof audioPayload.id === "string" ? audioPayload.id : "";
          let audioUrl = "";
          let transcribedText = "";

          if (mediaId) {
            try {
              const rawMediaUrl = (await resolveWhatsAppMediaUrl(mediaId, requestId)) ?? "";
              if (rawMediaUrl) {
                const fileData = await downloadWhatsAppMedia(rawMediaUrl, requestId);
                if (fileData) {
                  try {
                    const sttResult = await transcribeAudioFile(
                      fileData.data,
                      fileData.filename,
                      fileData.mimeType,
                      requestId
                    );
                    if (sttResult?.text) {
                      transcribedText = sttResult.text;
                    }
                  } catch (err) {
                    logWithCorrelation(
                      requestId,
                      "VOICE_STT_ERROR",
                      `platform=whatsapp transcription failed: ${err instanceof Error ? err.message : String(err)}`,
                      "error"
                    );
                  }

                  const storedUrl = await uploadVoiceToStorage(
                    fileData.data,
                    fileData.filename,
                    fileData.mimeType,
                    requestId
                  );
                  if (storedUrl) {
                    audioUrl = storedUrl;
                  }
                }
              }
            } catch (err) {
              logWithCorrelation(
                requestId,
                "STORAGE_ERROR",
                `platform=whatsapp audio upload failed: ${err instanceof Error ? err.message : String(err)}`,
                "error"
              );
            }
          }

          messages.push({
            platform: "whatsapp",
            messenger_id: `wa_${from}`,
            message: transcribedText || "[Voice Message]",
            audio_url: audioUrl || undefined,
            first_name: profileName,
            phone: from,
            metadata: {
              from,
              message_id: messageId,
              timestamp,
              type: type === "voice" ? "voice" : "audio",
              audio_url: audioUrl || null,
              media_id: mediaId || null
            },
            replied_to: repliedTo
          });
        }
      }
    }
  }

  return { messages, statuses };
}

export class WhatsAppAdapter implements PlatformAdapter {
  readonly name = "whatsapp";

  /**
   * WhatsApp supports quick-reply buttons (≤3) and list messages (>3 or explicit list).
   * URL buttons are not supported as interactive buttons — they fall back to text.
   */
  readonly capabilities: PlatformCapabilities = {
    quick_replies: true,
    url_buttons: false,
    lists: true,
    max_quick_replies: 3
  };

  /**
   * Send an interactive message.
   *
   * - quick_replies (≤3, no list) → WhatsApp reply-button interactive message
   * - quick_replies (>3) OR list provided → WhatsApp list interactive message
   * - url_buttons only → plain text fallback (WhatsApp doesn't support URL buttons natively)
   */
  async sendInteractive(
    messenger_id: string,
    message: Extract<AgentMessage, { type: "interactive" }>,
    metadata?: Record<string, unknown>
  ): Promise<SendResult> {
    const requestId = extractRequestId(metadata) ?? generateCorrelationId();
    const bodyText = normalizeInteractiveText(message.text, 1024) || "Please choose an option.";

    // Decide which interactive format to use
    const hasQuickReplies = (message.quick_replies?.length ?? 0) > 0;
    const hasList = !!message.list;
    const overButtonLimit = (message.quick_replies?.length ?? 0) > 3;

    // If only URL buttons (or nothing interactive), fall back to text
    if (!hasQuickReplies && !hasList) {
      return sendTextPayload(messenger_id, message.text, {
        applyNotificationThrottle: false,
        requestId
      });
    }

    if (!hasList && hasQuickReplies && !overButtonLimit) {
      // ── Reply-button message (≤3 buttons) ──────────────────────────────────
      const usedButtonIds = new Set<string>();
      const buttons: Array<{ type: "reply"; reply: { id: string; title: string } }> = [];

      for (const [index, button] of (message.quick_replies ?? []).slice(0, 3).entries()) {
        const title =
          normalizeInteractiveText(button.label, 20) ||
          normalizeInteractiveText(button.value ?? "", 20);
        if (!title) {
          continue;
        }

        const id = buildUniqueInteractiveId(
          button.value ?? button.label,
          `btn_${index + 1}`,
          usedButtonIds,
          256
        );
        buttons.push({
          type: "reply",
          reply: { id, title }
        });
      }

      if (buttons.length === 0) {
        return sendTextPayload(messenger_id, message.text, {
          applyNotificationThrottle: false,
          requestId
        });
      }

      return dispatchMessageToRecipient(
        messenger_id,
        {
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: bodyText },
            action: { buttons }
          }
        },
        { applyNotificationThrottle: false, requestId }
      );
    }

    // ── List message (>3 quick replies OR explicit list) ────────────────────
    const usedRowIds = new Set<string>();
    let sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }> = [];

    if (hasList && message.list) {
      let totalRows = 0;

      for (const section of message.list.sections) {
        if (totalRows >= 10) {
          break;
        }

        const rows: Array<{ id: string; title: string; description?: string }> = [];
        for (const item of section.items) {
          if (totalRows >= 10) {
            break;
          }

          const rowTitle = normalizeInteractiveText(item.title, 24);
          if (!rowTitle) {
            continue;
          }

          const rowId = buildUniqueInteractiveId(item.id, rowTitle, usedRowIds, 200);
          const rowDescription = item.description
            ? normalizeInteractiveText(item.description, 72)
            : "";

          rows.push({
            id: rowId,
            title: rowTitle,
            ...(rowDescription ? { description: rowDescription } : {})
          });
          totalRows += 1;
        }

        if (rows.length > 0) {
          const sectionTitle = section.title ? normalizeInteractiveText(section.title, 24) : "";
          sections.push(sectionTitle ? { title: sectionTitle, rows } : { rows });
        }
      }
    } else {
      const rows: Array<{ id: string; title: string }> = [];
      for (const [index, button] of (message.quick_replies ?? []).slice(0, 10).entries()) {
        const rowTitle =
          normalizeInteractiveText(button.label, 24) ||
          normalizeInteractiveText(button.value ?? "", 24);
        if (!rowTitle) {
          continue;
        }

        const rowId = buildUniqueInteractiveId(
          button.value ?? button.label,
          `btn_${index + 1}`,
          usedRowIds,
          200
        );
        rows.push({ id: rowId, title: rowTitle });
      }

      if (rows.length > 0) {
        sections = [{ rows }];
      }
    }

    const normalizedSections = sections
      .map(section => {
        const rows = section.rows
          .map(row => {
            const title = normalizeInteractiveText(row.title, 24);
            if (!title) {
              return null;
            }

            const id = normalizeInteractiveText(row.id, 200);
            if (!id) {
              return null;
            }

            const description = row.description
              ? normalizeInteractiveText(row.description, 72)
              : "";

            return {
              id,
              title,
              ...(description ? { description } : {})
            };
          })
          .filter((row): row is { id: string; title: string; description?: string } => row !== null);

        return {
          title: section.title ? normalizeInteractiveText(section.title, 24) : "",
          rows
        };
      })
      .filter(section => section.rows.length > 0)
      .map((section, sectionIndex, allSections) => {
        if (allSections.length > 1) {
          return {
            title: section.title || `Section ${sectionIndex + 1}`,
            rows: section.rows
          };
        }

        if (section.title) {
          return {
            title: section.title,
            rows: section.rows
          };
        }

        return { rows: section.rows };
      });

    if (normalizedSections.length === 0) {
      return sendTextPayload(messenger_id, message.text, {
        applyNotificationThrottle: false,
        requestId
      });
    }

    const buttonLabel = normalizeInteractiveText(message.list?.button_label ?? "View options", 20) || "View options";

    return dispatchMessageToRecipient(
      messenger_id,
      {
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: { button: buttonLabel, sections: normalizedSections }
        }
      },
      { applyNotificationThrottle: false, requestId }
    );
  }

  async sendMessage(
    messenger_id: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<SendResult> {
    const requestId = extractRequestId(metadata);
    // Interactive chat replies should not be blocked by notification throttling.
    return sendTextPayload(messenger_id, message, {
      applyNotificationThrottle: false,
      requestId
    });
  }

  async sendPhoto(
    messenger_id: string,
    url: string,
    caption?: string,
    metadata?: Record<string, unknown>
  ): Promise<SendResult> {
    const requestId = extractRequestId(metadata);
    // Interactive chat replies should not be blocked by notification throttling.
    return sendImagePayload(messenger_id, url, caption, {
      applyNotificationThrottle: false,
      requestId
    });
  }

  async sendAudio(
    messenger_id: string,
    url: string,
    metadata?: Record<string, unknown>
  ): Promise<SendResult> {
    const requestId = extractRequestId(metadata) ?? generateCorrelationId();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return { success: false, error: "Audio URL cannot be empty" };
    }

    try {
      const uploadResult = await uploadWhatsAppMediaFromUrl(trimmedUrl, requestId);
      if (uploadResult.success) {
        return dispatchMessageToRecipient(
          messenger_id,
          {
            type: "audio",
            audio: { id: uploadResult.mediaId }
          },
          { applyNotificationThrottle: false, requestId }
        );
      }

      logWithCorrelation(
        requestId,
        "DOWNSTREAM_ERROR",
        `platform=whatsapp audio_media_upload detail="${uploadResult.error}"`,
        "warn"
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logWithCorrelation(
        requestId,
        "DOWNSTREAM_ERROR",
        `platform=whatsapp audio_media_upload detail="${errorMessage}"`,
        "warn"
      );
    }

    return dispatchMessageToRecipient(
      messenger_id,
      {
        type: "audio",
        audio: { link: trimmedUrl }
      },
      { applyNotificationThrottle: false, requestId }
    );
  }

  async initialize(): Promise<void> {
    const token = getWhatsAppToken();
    const phoneNumberId = getWhatsAppPhoneNumberId();

    if (!token || !phoneNumberId) {
      console.warn("WhatsApp adapter initialized without full configuration.");
      return;
    }

    console.log(`WhatsApp adapter ready for phone number id ${phoneNumberId}`);
  }

  validateMessengerId(messenger_id: string): boolean {
    return /^wa_\d+$/.test(messenger_id);
  }
}
