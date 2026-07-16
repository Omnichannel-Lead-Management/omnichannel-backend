/**
 * MessageOrchestrator Service
 *
 * Core orchestration logic:
 * 1. Saves incoming messages to database
 * 2. Loads chat history
 * 3. Forwards to external AI endpoint
 * 4. Handles replies from AI
 *
 * NO AI LOGIC HERE - Pure routing and storage
 */

import { db, schema } from "../db";
import { eq, and, desc, gte } from "drizzle-orm";
import { getPlatformAdapter } from "../platforms";
import { getBusinessById, resolveAdapterForBusiness } from "./BusinessRegistry";
import {
  CORRELATION_ID_HEADER,
  generateCorrelationId,
  logWithCorrelation
} from "../middleware/correlationId";
import type { AgentMessage, IncomingMessage, AIRequestPayload, ChatHistoryEntry, PlatformCapabilities } from "../platforms/PlatformAdapter";
import { agentHub } from "./AgentHub";
import { transcribeAudio, synthesizeSpeech } from "./VoiceService";

// ─────────────────────────────────────────────────────────────────────────────
// Fallback: convert an interactive message to plain text when the platform or
// adapter does not support native interactive rendering.
// ─────────────────────────────────────────────────────────────────────────────
function interactiveToText(msg: Extract<AgentMessage, { type: "interactive" }>): string {
  let text = msg.text;

  if (msg.quick_replies?.length) {
    text += "\n";
    msg.quick_replies.forEach((btn, i) => {
      text += `\n${i + 1}. ${btn.label}`;
    });
  }

  if (msg.url_buttons?.length) {
    text += "\n";
    msg.url_buttons.forEach(btn => {
      text += `\n• ${btn.label}: ${btn.url}`;
    });
  }

  if (msg.list) {
    for (const section of msg.list.sections) {
      text += "\n";
      if (section.title) text += `\n${section.title}`;
      section.items.forEach((item, i) => {
        text += `\n${i + 1}. ${item.title}`;
        if (item.description) text += ` — ${item.description}`;
      });
    }
  }

  return text.trimEnd();
}

/** Default capabilities returned when an adapter doesn't declare its own. */
const UNKNOWN_CAPABILITIES: PlatformCapabilities = {
  quick_replies: false,
  url_buttons: false,
  lists: false,
  max_quick_replies: null
};

type SupportedLanguageCode = "en" | "si" | "ta";

type LanguageControlAction =
  | { kind: "menu" }
  | { kind: "set"; language: SupportedLanguageCode };

function normalizeLanguageCode(value: unknown): SupportedLanguageCode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "english" || normalized.startsWith("en")) {
    return "en";
  }

  if (normalized === "sinhala" || normalized === "sinhalese" || normalized.startsWith("si")) {
    return "si";
  }

  if (normalized === "tamil" || normalized.startsWith("ta")) {
    return "ta";
  }

  return null;
}

function detectLanguageFromText(text: string): SupportedLanguageCode {
  if (/[\u0D80-\u0DFF]/.test(text)) {
    return "si";
  }

  if (/[\u0B80-\u0BFF]/.test(text)) {
    return "ta";
  }

  return "en";
}

function resolveMessageLanguage(
  text: string,
  incomingLanguage?: unknown,
  preferredLanguage?: unknown
): SupportedLanguageCode {
  const detected = detectLanguageFromText(text);
  if (detected !== "en") {
    return detected;
  }

  const normalizedIncoming = normalizeLanguageCode(incomingLanguage);
  if (normalizedIncoming) {
    return normalizedIncoming;
  }

  const normalizedPreferred = normalizeLanguageCode(preferredLanguage);
  if (normalizedPreferred) {
    return normalizedPreferred;
  }

  return "en";
}

function normalizeLanguageControlValue(value: string): SupportedLanguageCode | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();

  if (normalized === "en" || normalized === "english" || normalized.startsWith("en-")) {
    return "en";
  }

  if (
    normalized === "si" ||
    normalized === "sinhala" ||
    normalized === "sinhalese" ||
    normalized.startsWith("si-") ||
    trimmed === "සිංහල"
  ) {
    return "si";
  }

  if (normalized === "ta" || normalized === "tamil" || normalized.startsWith("ta-") || trimmed === "தமிழ்") {
    return "ta";
  }

  return null;
}

function parseLanguageControlMessage(message: string): LanguageControlAction | null {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === "__lang_menu") {
    return { kind: "menu" };
  }

  if (normalized.startsWith("__lang_")) {
    const value = normalized.slice("__lang_".length);
    const language = normalizeLanguageControlValue(value);
    if (language) {
      return { kind: "set", language };
    }
  }

  const langCommandMatch = /^\/?(?:lang|language)(?:\s+(.+))?$/i.exec(trimmed);
  if (langCommandMatch) {
    const value = langCommandMatch[1]?.trim();
    if (!value) {
      return { kind: "menu" };
    }

    const language = normalizeLanguageControlValue(value);
    if (language) {
      return { kind: "set", language };
    }
  }

  if (
    normalized === "change language" ||
    normalized === "switch language" ||
    normalized === "language" ||
    trimmed === "භාෂාව" ||
    trimmed === "භාෂාව වෙනස් කරන්න" ||
    trimmed === "மொழி" ||
    trimmed === "மொழியை மாற்று"
  ) {
    return { kind: "menu" };
  }

  const directLanguage = normalizeLanguageControlValue(trimmed);
  if (directLanguage) {
    return { kind: "set", language: directLanguage };
  }

  return null;
}

function getLanguageMenuText(language: SupportedLanguageCode): string {
  if (language === "si") {
    return "කරුණාකර ඔබට අවශ්‍ය භාෂාව තෝරන්න.";
  }

  if (language === "ta") {
    return "தயவுசெய்து உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்.";
  }

  return "Please choose your preferred language.";
}

function getLanguageChangedText(language: SupportedLanguageCode): string {
  if (language === "si") {
    return "භාෂාව සිංහල ලෙස සකසා ඇත.";
  }

  if (language === "ta") {
    return "மொழி தமிழ் ஆக மாற்றப்பட்டது.";
  }

  return "Language has been changed to English.";
}

function buildLanguageSelectionInteractive(
  language: SupportedLanguageCode
): Extract<AgentMessage, { type: "interactive" }> {
  return {
    type: "interactive",
    text: getLanguageMenuText(language),
    quick_replies: [
      { label: "English", value: "__lang_en" },
      { label: "සිංහල", value: "__lang_si" },
      { label: "தமிழ்", value: "__lang_ta" }
    ]
  };
}

export class MessageOrchestrator {
  private externalAIEndpoint: string;
  private adminDeescalateKey: string;

  constructor() {
    this.externalAIEndpoint = process.env.ROUTING_AGENT_URL || process.env.EXTERNAL_AI_ENDPOINT || "http://localhost:3001/chat";
    this.adminDeescalateKey = process.env.ADMIN_DEESCALATE_KEY || "";
    console.log(`🤖 Routing Agent configured: ${this.externalAIEndpoint}`);
    if (this.adminDeescalateKey) {
      console.log(`🔑 Admin de-escalate key configured`);
    } else {
      console.warn(`⚠️  ADMIN_DEESCALATE_KEY not set — admin override disabled`);
    }
  }

  /**
   * Resolve the platform adapter to use for a message. When business_id is set
   * (multi-tenant webhook routes), this uses that business's own stored
   * credentials instead of the global .env-based singleton adapter — falling
   * back to the singleton if the business has no adapter for that platform.
   */
  private async resolveAdapter(platform: string, business_id?: string) {
    if (business_id && business_id !== "biz_default") {
      const business = await getBusinessById(business_id);
      if (business) {
        const businessAdapter = resolveAdapterForBusiness(platform, business);
        if (businessAdapter) return businessAdapter;
      }
    }

    return getPlatformAdapter(platform);
  }

  /**
   * Process an incoming message from any platform
   * Main orchestration flow
   */
  async processIncomingMessage(payload: IncomingMessage): Promise<{ success: boolean; error?: string }> {
    try {
      const requestId = payload.request_id || generateCorrelationId();
      const correlatedPayload: IncomingMessage = {
        ...payload,
        request_id: requestId
      };

      const existingMessengerInfo = await this.getMessengerInfo(
        correlatedPayload.messenger_id,
        correlatedPayload.platform,
        correlatedPayload.business_id
      );

      correlatedPayload.language = resolveMessageLanguage(
        correlatedPayload.message,
        correlatedPayload.language,
        existingMessengerInfo?.preferred_language
      );

      logWithCorrelation(
        requestId,
        "INCOMING_MESSAGE",
        `platform=${correlatedPayload.platform} messenger_id=${correlatedPayload.messenger_id} text="${correlatedPayload.message}"`
      );

      // 1. Upsert messenger info
      await this.upsertMessenger(correlatedPayload);

      // 2. If the incoming message is a voice note, transcribe placeholder text via STT before saving
      const metadataType =
        correlatedPayload.metadata && typeof correlatedPayload.metadata.type === "string"
          ? correlatedPayload.metadata.type.toLowerCase()
          : "";
      let isVoiceMessage = Boolean(correlatedPayload.audio_url) || metadataType === "audio" || metadataType === "voice";

      const isVoicePlaceholder = /^\[(voice|audio) message\]$/i.test(correlatedPayload.message.trim());

      if (correlatedPayload.audio_url && isVoicePlaceholder) {
        try {
          logWithCorrelation(requestId, "VOICE_STT", `transcribing audio_url=${correlatedPayload.audio_url}`);
          const sttResult = await transcribeAudio(correlatedPayload.audio_url, requestId);
          if (sttResult) {
            correlatedPayload.message = sttResult.text;
            correlatedPayload.language = resolveMessageLanguage(
              sttResult.text,
              sttResult.language || correlatedPayload.language,
              existingMessengerInfo?.preferred_language
            );
            isVoiceMessage = true;
            logWithCorrelation(requestId, "VOICE_STT", `transcription="${sttResult.text}" lang=${sttResult.language}`);
          } else {
            logWithCorrelation(requestId, "VOICE_STT", "no transcription returned", "warn");
          }
        } catch (err) {
          logWithCorrelation(
            requestId,
            "VOICE_STT_ERROR",
            err instanceof Error ? err.message : String(err),
            "error"
          );
        }
      }

      // 3. Save incoming message (with transcribed text if voice)
      await this.saveMessage({
        messenger_id: correlatedPayload.messenger_id,
        platform: correlatedPayload.platform,
        business_id: correlatedPayload.business_id,
        message_text: correlatedPayload.message,
        is_from_user: true,
        metadata: correlatedPayload.metadata ? JSON.stringify(correlatedPayload.metadata) : null
      });

      // 4. Admin override: de-escalate if the magic key is sent
      let messengerInfo = await this.getMessengerInfo(
        correlatedPayload.messenger_id,
        correlatedPayload.platform,
        correlatedPayload.business_id
      );
      if (
        this.adminDeescalateKey &&
        correlatedPayload.message.trim() === this.adminDeescalateKey &&
        messengerInfo?.is_escalated
      ) {
        logWithCorrelation(
          requestId,
          "ROUTING_DECISION",
          `platform=${correlatedPayload.platform} messenger_id=${correlatedPayload.messenger_id} decision=admin_deescalate`
        );
        await db
          .update(schema.messengers)
          .set({
            is_escalated: 0,
            escalation_status: "none",
            claimed_by_agent_id: null,
            claimed_at: null,
            released_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .where(
            and(
              eq(schema.messengers.messenger_id, correlatedPayload.messenger_id),
              eq(schema.messengers.platform, correlatedPayload.platform),
              eq(schema.messengers.business_id, correlatedPayload.business_id || "biz_default")
            )
          );
        const adapter = await this.resolveAdapter(correlatedPayload.platform, correlatedPayload.business_id);
        const confirmMsg = "[Admin] Conversation de-escalated. AI routing resumed.";
        if (adapter) {
          await adapter.sendMessage(correlatedPayload.messenger_id, confirmMsg, {
            request_id: requestId
          });
        }
        await this.saveReply(correlatedPayload.messenger_id, correlatedPayload.platform, confirmMsg, {
          request_id: requestId
        }, correlatedPayload.business_id);
        await agentHub.notifyConversationDeEscalated(correlatedPayload.platform, correlatedPayload.messenger_id);
        logWithCorrelation(
          requestId,
          "OUTBOUND_RESPONSE",
          `platform=${correlatedPayload.platform} messenger_id=${correlatedPayload.messenger_id} type=text reason=admin_deescalate`
        );
        return { success: true };
      }

      const languageControlAction = parseLanguageControlMessage(correlatedPayload.message);
      if (languageControlAction) {
        if (languageControlAction.kind === "menu") {
          await this.sendLanguageSelectionMenu(correlatedPayload, requestId);
          return { success: true };
        }

        await this.setPreferredLanguage(
          correlatedPayload.messenger_id,
          correlatedPayload.platform,
          languageControlAction.language,
          correlatedPayload.business_id
        );
        correlatedPayload.language = languageControlAction.language;

        const languageChangedText = getLanguageChangedText(languageControlAction.language);
        const adapter = await this.resolveAdapter(correlatedPayload.platform, correlatedPayload.business_id);

        if (adapter) {
          const sendResult = await adapter.sendMessage(correlatedPayload.messenger_id, languageChangedText, {
            request_id: requestId
          });
          if (!sendResult.success) {
            logWithCorrelation(
              requestId,
              "DOWNSTREAM_ERROR",
              `platform=${correlatedPayload.platform} messenger_id=${correlatedPayload.messenger_id} type=text reason=language_changed detail="${sendResult.error ?? "unknown error"}"`,
              "error"
            );
          }
        }

        await this.saveReply(correlatedPayload.messenger_id, correlatedPayload.platform, languageChangedText, {
          type: "language_changed",
          language: languageControlAction.language,
          request_id: requestId
        }, correlatedPayload.business_id);
        logWithCorrelation(
          requestId,
          "ROUTING_DECISION",
          `platform=${correlatedPayload.platform} messenger_id=${correlatedPayload.messenger_id} decision=language_changed language=${languageControlAction.language}`
        );
        return { success: true };
      }

      // 5. If conversation is escalated, route the message to the agent channel.
      if (messengerInfo?.is_escalated) {
        if (!agentHub.hasConnectedAgents()) {
          await db
            .update(schema.messengers)
            .set({
              is_escalated: 0,
              escalation_status: "none",
              claimed_by_agent_id: null,
              claimed_at: null,
              released_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .where(
              and(
                eq(schema.messengers.messenger_id, correlatedPayload.messenger_id),
                eq(schema.messengers.platform, correlatedPayload.platform),
                eq(schema.messengers.business_id, correlatedPayload.business_id || "biz_default")
              )
            );

          await agentHub.notifyConversationDeEscalated(
            correlatedPayload.platform,
            correlatedPayload.messenger_id
          );

          const adapter = await this.resolveAdapter(correlatedPayload.platform, correlatedPayload.business_id);
          const autoDeEscalatedMessage =
            "Our live agents are currently unavailable, so I switched you back to the AI assistant.";

          if (adapter) {
            await adapter.sendMessage(correlatedPayload.messenger_id, autoDeEscalatedMessage, {
              request_id: requestId
            });
          }

          await this.saveReply(
            correlatedPayload.messenger_id,
            correlatedPayload.platform,
            autoDeEscalatedMessage,
            {
              type: "auto_deescalated_no_agents",
              request_id: requestId
            },
            correlatedPayload.business_id
          );

          messengerInfo = {
            ...messengerInfo,
            is_escalated: 0,
            escalation_status: "none",
            claimed_by_agent_id: null
          };

          logWithCorrelation(
            requestId,
            "ROUTING_DECISION",
            `platform=${correlatedPayload.platform} messenger_id=${correlatedPayload.messenger_id} decision=auto_deescalate_no_agents`
          );
        } else {
          logWithCorrelation(
            requestId,
            "ROUTING_DECISION",
            `platform=${correlatedPayload.platform} messenger_id=${correlatedPayload.messenger_id} decision=route_to_human_agent`
          );
          await agentHub.handleEscalatedUserMessage({
            platform: correlatedPayload.platform,
            messenger_id: correlatedPayload.messenger_id,
            text: correlatedPayload.message
          });

          return { success: true };
        }
      }

      // 5. Load chat history (within the past month, up to 4000 chars)
      const history = await this.getChatHistory(
        correlatedPayload.messenger_id,
        correlatedPayload.platform,
        4000,
        correlatedPayload.business_id
      );

      // 6. Prepare payload for external AI (include platform capabilities so agents
      //    can decide whether to return interactive messages)
      const adapter = await this.resolveAdapter(correlatedPayload.platform, correlatedPayload.business_id);
      const aiPayload: AIRequestPayload = {
        request_id: requestId,
        messenger_id: correlatedPayload.messenger_id,
        platform: correlatedPayload.platform,
        business_id: correlatedPayload.business_id,
        message: correlatedPayload.message,
        image_url: correlatedPayload.image_url,
        language: resolveMessageLanguage(
          correlatedPayload.message,
          correlatedPayload.language,
          messengerInfo?.preferred_language
        ),
        history,
        user_info: {
          first_name: messengerInfo?.first_name || correlatedPayload.first_name,
          last_name: messengerInfo?.last_name || correlatedPayload.last_name,
          username: messengerInfo?.username || correlatedPayload.username,
          phone: messengerInfo?.phone || correlatedPayload.phone,
          linked_user_id: messengerInfo?.linked_user_id || undefined
        },
        platform_capabilities: adapter?.capabilities ?? UNKNOWN_CAPABILITIES,
        replied_to: correlatedPayload.replied_to
      };

      // 7. Forward to external AI endpoint
      await this.forwardToAI(aiPayload, isVoiceMessage);

      logWithCorrelation(
        requestId,
        "ROUTING_DECISION",
        `platform=${correlatedPayload.platform} messenger_id=${correlatedPayload.messenger_id} decision=route_to_ai`
      );
      return { success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      const requestId = payload.request_id || generateCorrelationId();
      logWithCorrelation(requestId, "PROCESSING_ERROR", errorMsg, "error");
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Save a reply message from AI to database
   */
  async saveReply(
    messenger_id: string,
    platform: string,
    reply_text: string,
    metadata?: Record<string, any>,
    business_id?: string
  ): Promise<void> {
    await this.saveMessage({
      messenger_id,
      platform,
      business_id: business_id || "biz_default",
      message_text: reply_text,
      is_from_user: false,
      metadata: metadata ? JSON.stringify(metadata) : null
    });

    console.log(`💾 Reply saved for ${platform}:${messenger_id}`);
  }

  /**
   * Upsert messenger information
   * Creates new entry if doesn't exist, updates if exists
   */
  private async upsertMessenger(payload: IncomingMessage): Promise<void> {
    const businessId = payload.business_id || "biz_default";
    const existing = await db
      .select()
      .from(schema.messengers)
      .where(
        and(
          eq(schema.messengers.messenger_id, payload.messenger_id),
          eq(schema.messengers.platform, payload.platform),
          eq(schema.messengers.business_id, businessId)
        )
      )
      .then((rows) => rows[0]);

    if (existing) {
      // Update existing messenger
      await db
        .update(schema.messengers)
        .set({
          first_name: payload.first_name || existing.first_name,
          last_name: payload.last_name || existing.last_name,
          username: payload.username || existing.username,
          phone: payload.phone || existing.phone,
          preferred_language: payload.language || existing.preferred_language,
          metadata: payload.metadata ? JSON.stringify(payload.metadata) : existing.metadata,
          updated_at: new Date().toISOString()
        })
        .where(eq(schema.messengers.id, existing.id));
    } else {
      // Insert new messenger
      await db.insert(schema.messengers).values({
        messenger_id: payload.messenger_id,
        platform: payload.platform,
        business_id: businessId,
        first_name: payload.first_name || null,
        last_name: payload.last_name || null,
        username: payload.username || null,
        phone: payload.phone || null,
        preferred_language: payload.language || "en",
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null
      });

      console.log(`👤 New messenger registered: ${payload.platform}:${payload.messenger_id} (business=${businessId})`);
    }
  }

  private async setPreferredLanguage(
    messenger_id: string,
    platform: string,
    language: SupportedLanguageCode,
    business_id?: string
  ): Promise<void> {
    await db
      .update(schema.messengers)
      .set({
        preferred_language: language,
        updated_at: new Date().toISOString()
      })
      .where(
        and(
          eq(schema.messengers.messenger_id, messenger_id),
          eq(schema.messengers.platform, platform),
          eq(schema.messengers.business_id, business_id || "biz_default")
        )
      );
  }

  private async sendLanguageSelectionMenu(payload: IncomingMessage, requestId: string): Promise<void> {
    const adapter = await this.resolveAdapter(payload.platform, payload.business_id);
    if (!adapter) {
      return;
    }

    const language = resolveMessageLanguage(payload.message, payload.language);
    const menuMessage = buildLanguageSelectionInteractive(language);
    let menuSendResult: { success: boolean; error?: string } = { success: true };

    if (payload.platform === "telegram") {
      const inline_keyboard = [
        [
          { text: "English", callback_data: "__lang_en" },
          { text: "සිංහල", callback_data: "__lang_si" },
          { text: "தமிழ்", callback_data: "__lang_ta" }
        ]
      ];

      menuSendResult = await adapter.sendMessage(payload.messenger_id, menuMessage.text, {
        request_id: requestId,
        inline_keyboard
      });
    } else if (adapter.sendInteractive) {
      menuSendResult = await adapter.sendInteractive(payload.messenger_id, menuMessage, {
        request_id: requestId
      });
    } else {
      const fallbackText = `${menuMessage.text}\n1. English\n2. සිංහල\n3. தமிழ்\nSend: /lang en | /lang si | /lang ta`;
      menuSendResult = await adapter.sendMessage(payload.messenger_id, fallbackText, {
        request_id: requestId
      });
    }

    if (!menuSendResult.success) {
      logWithCorrelation(
        requestId,
        "DOWNSTREAM_ERROR",
        `platform=${payload.platform} messenger_id=${payload.messenger_id} type=interactive reason=language_menu detail="${menuSendResult.error ?? "unknown error"}"`,
        "error"
      );
    }

    await this.saveReply(payload.messenger_id, payload.platform, menuMessage.text, {
      type: "language_menu",
      request_id: requestId
    }, payload.business_id);

    logWithCorrelation(
      requestId,
      "OUTBOUND_RESPONSE",
      `platform=${payload.platform} messenger_id=${payload.messenger_id} type=interactive reason=language_menu`
    );
  }

  /**
   * Save a message to database
   */
  private async saveMessage(message: {
    messenger_id: string;
    platform: string;
    business_id?: string;
    message_text: string;
    is_from_user: boolean;
    metadata: string | null;
  }): Promise<void> {
    await db.insert(schema.chatMessages).values({
      messenger_id: message.messenger_id,
      platform: message.platform,
      business_id: message.business_id || "biz_default",
      message_text: message.message_text,
      is_from_user: message.is_from_user,
      metadata: message.metadata
    });
  }

  /**
   * Get chat history for a messenger.
   * Only includes messages from the past month.
   * Fills up to maxChars total characters (newest-first selection);
   * any message that would overflow the budget is excluded entirely.
   */
  async getChatHistory(
    messenger_id: string,
    platform: string,
    maxChars: number = 4000,
    business_id?: string
  ): Promise<ChatHistoryEntry[]> {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const cutoff = oneMonthAgo.toISOString().replace("T", " ").slice(0, 19);

    const messages = await db
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.messenger_id, messenger_id),
          eq(schema.chatMessages.platform, platform),
          eq(schema.chatMessages.business_id, business_id || "biz_default"),
          gte(schema.chatMessages.created_at, cutoff)
        )
      )
      .orderBy(desc(schema.chatMessages.created_at));

    // Select newest messages that fit within the character budget.
    // Stop as soon as a message would push us over the limit.
    let chars = 0;
    const selected: typeof messages = [];
    for (const msg of messages) {
      const len = msg.message_text.length;
      if (chars + len > maxChars) break;
      chars += len;
      selected.push(msg);
    }

    // Restore chronological order (oldest first)
    return selected.reverse().map(msg => ({
      is_from_user: Boolean(msg.is_from_user),
      text: msg.message_text,
      timestamp: msg.created_at || new Date().toISOString()
    }));
  }

  /**
   * Get recent chat history by message count for APIs/UIs.
   */
  async getRecentChatHistory(
    messenger_id: string,
    platform: string,
    limit: number = 20,
    business_id?: string
  ): Promise<ChatHistoryEntry[]> {
    const safeLimit = Math.max(1, Math.min(limit, 500));

    const messages = await db
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.messenger_id, messenger_id),
          eq(schema.chatMessages.platform, platform),
          eq(schema.chatMessages.business_id, business_id || "biz_default")
        )
      )
      .orderBy(desc(schema.chatMessages.created_at))
      .limit(safeLimit);

    return messages.reverse().map(msg => ({
      is_from_user: Boolean(msg.is_from_user),
      text: msg.message_text,
      timestamp: msg.created_at || new Date().toISOString()
    }));
  }

  /**
   * Get full conversation history for a specific session as UI-friendly records.
   */
  async getFullSessionHistory(
    messenger_id: string,
    platform: string,
    business_id?: string
  ): Promise<Array<{ role: "user" | "assistant"; content: string; timestamp: string }>> {
    const messages = await db
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.messenger_id, messenger_id),
          eq(schema.chatMessages.platform, platform),
          eq(schema.chatMessages.business_id, business_id || "biz_default")
        )
      )
      .orderBy(schema.chatMessages.created_at);

    return messages.map((msg) => ({
      role: msg.is_from_user ? "user" : "assistant",
      content: msg.message_text,
      timestamp: msg.created_at || new Date().toISOString()
    }));
  }

  /**
   * Get messenger information
   */
  private async getMessengerInfo(messenger_id: string, platform: string, business_id?: string) {
    return await db
      .select()
      .from(schema.messengers)
      .where(
        and(
          eq(schema.messengers.messenger_id, messenger_id),
          eq(schema.messengers.platform, platform),
          eq(schema.messengers.business_id, business_id || "biz_default")
        )
      )
      .then((rows) => rows[0]);
  }

  /**
   * Forward message to routing agent, then dispatch each reply message
   * via the appropriate platform adapter.
   * When isVoiceMessage is true and the adapter supports sendAudio, text replies
   * are synthesized to speech and sent as voice notes.
   */
  private async forwardToAI(payload: AIRequestPayload, isVoiceMessage: boolean = false): Promise<void> {
    const requestId = payload.request_id || generateCorrelationId();

    try {
      logWithCorrelation(
        requestId,
        "ROUTING_DECISION",
        `platform=${payload.platform} messenger_id=${payload.messenger_id} decision=invoke_routing_agent endpoint=${this.externalAIEndpoint} language=${payload.language}`
      );

      const response = await fetch(this.externalAIEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CORRELATION_ID_HEADER]: requestId
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Routing agent returned ${response.status}: ${errorText}`);
      }

      const result = await response.json() as {
        success: boolean;
        messages?: AgentMessage[];
        escalated?: boolean;
        escalation_tag?: string;
        escalation_summary?: string;
        error?: string;
      };

      if (!result.success) {
        logWithCorrelation(
          requestId,
          "ROUTING_DECISION",
          `platform=${payload.platform} messenger_id=${payload.messenger_id} decision=routing_agent_unsuccessful detail="${result.error ?? "(empty)"}"`,
          "warn"
        );
        return;
      }

      const adapter = await this.resolveAdapter(payload.platform, payload.business_id);
      if (!adapter) {
        logWithCorrelation(
          requestId,
          "ROUTING_ERROR",
          `no adapter for platform=${payload.platform}`,
          "error"
        );
        return;
      }

      // If the downstream agent flagged an escalation, mark this conversation
      if (result.escalated) {
        await db
          .update(schema.messengers)
          .set({
            is_escalated: 1,
            escalation_status: "queued",
            claimed_by_agent_id: null,
            claimed_at: null,
            escalation_requested_at: new Date().toISOString(),
            escalation_tag: result.escalation_tag ?? null,
            escalation_summary: result.escalation_summary ?? null,
            updated_at: new Date().toISOString()
          })
          .where(
            and(
              eq(schema.messengers.messenger_id, payload.messenger_id),
              eq(schema.messengers.platform, payload.platform),
              eq(schema.messengers.business_id, payload.business_id || "biz_default")
            )
          );
        logWithCorrelation(
          requestId,
          "ROUTING_DECISION",
          `platform=${payload.platform} messenger_id=${payload.messenger_id} decision=escalated_to_human_queue`
        );

        await agentHub.notifyConversationQueued(payload.platform, payload.messenger_id);

        if (!agentHub.hasConnectedAgents()) {
          const noAgentMessage = "No customer care agents are available right now. Please wait a few hours and try again.";
          await adapter.sendMessage(payload.messenger_id, noAgentMessage, {
            request_id: requestId
          });
          await this.saveReply(payload.messenger_id, payload.platform, noAgentMessage, {
            type: "escalation_notice",
            no_agents_available: true,
            request_id: requestId
          }, payload.business_id);
          logWithCorrelation(
            requestId,
            "OUTBOUND_RESPONSE",
            `platform=${payload.platform} messenger_id=${payload.messenger_id} type=text reason=no_agents_available`
          );
        } else {
          const queuedMessage = "Your chat has been escalated to customer care. Please wait while an agent claims this chat.";
          await adapter.sendMessage(payload.messenger_id, queuedMessage, {
            request_id: requestId
          });
          await this.saveReply(payload.messenger_id, payload.platform, queuedMessage, {
            type: "escalation_notice",
            no_agents_available: false,
            request_id: requestId
          }, payload.business_id);
          logWithCorrelation(
            requestId,
            "OUTBOUND_RESPONSE",
            `platform=${payload.platform} messenger_id=${payload.messenger_id} type=text reason=chat_queued_for_agent`
          );
        }
      }

      if (!result.messages?.length) {
        logWithCorrelation(
          requestId,
          "ROUTING_DECISION",
          `platform=${payload.platform} messenger_id=${payload.messenger_id} decision=no_outbound_messages detail="${result.error ?? "(empty)"}"`,
          "warn"
        );
        return;
      }

      for (const msg of result.messages) {
        if (msg.type === "interactive") {
          // Use native interactive sending if the adapter supports it;
          // otherwise convert to plain text so the user always gets a reply.
          if (adapter.sendInteractive) {
            await adapter.sendInteractive(payload.messenger_id, msg, { request_id: requestId });
          } else {
            await adapter.sendMessage(payload.messenger_id, interactiveToText(msg), {
              request_id: requestId
            });
          }
          await this.saveReply(payload.messenger_id, payload.platform, msg.text, {
            type: "interactive",
            request_id: requestId
          }, payload.business_id);
          logWithCorrelation(
            requestId,
            "OUTBOUND_RESPONSE",
            `platform=${payload.platform} messenger_id=${payload.messenger_id} type=interactive native=${!!adapter.sendInteractive}`
          );
        } else if (msg.type === "photo") {
          if (adapter.sendPhoto) {
            await adapter.sendPhoto(payload.messenger_id, msg.url, msg.caption, {
              request_id: requestId
            });
          } else {
            // Fallback: send URL as text if adapter doesn't support photos
            await adapter.sendMessage(
              payload.messenger_id,
              msg.caption ? `${msg.caption}\n${msg.url}` : msg.url,
              { request_id: requestId }
            );
          }
          // Save caption (or URL) as the stored reply text
          await this.saveReply(
            payload.messenger_id,
            payload.platform,
            msg.caption ?? msg.url,
            {
              type: "photo",
              url: msg.url,
              request_id: requestId
            },
            payload.business_id
          );
          logWithCorrelation(
            requestId,
            "OUTBOUND_RESPONSE",
            `platform=${payload.platform} messenger_id=${payload.messenger_id} type=photo url=${msg.url}`
          );
        } else if (msg.type === "audio") {
          const audioSendResult = adapter.sendAudio
            ? await adapter.sendAudio(payload.messenger_id, msg.url, { request_id: requestId })
            : await adapter.sendMessage(payload.messenger_id, msg.url, { request_id: requestId });

          if (!audioSendResult.success) {
            logWithCorrelation(
              requestId,
              "DOWNSTREAM_ERROR",
              `platform=${payload.platform} messenger_id=${payload.messenger_id} type=audio detail="${audioSendResult.error ?? "unknown error"}"`,
              "error"
            );

            const fallbackText = `Audio message: ${msg.url}`;
            const fallbackResult = await adapter.sendMessage(payload.messenger_id, fallbackText, {
              request_id: requestId
            });

            if (fallbackResult.success) {
              await this.saveReply(payload.messenger_id, payload.platform, fallbackText, {
                type: "audio_fallback",
                url: msg.url,
                request_id: requestId
              }, payload.business_id);
              logWithCorrelation(
                requestId,
                "OUTBOUND_RESPONSE",
                `platform=${payload.platform} messenger_id=${payload.messenger_id} type=text reason=audio_send_failed_fallback`
              );
            } else {
              logWithCorrelation(
                requestId,
                "DOWNSTREAM_ERROR",
                `platform=${payload.platform} messenger_id=${payload.messenger_id} type=text reason=audio_send_failed_fallback detail="${fallbackResult.error ?? "unknown error"}"`,
                "error"
              );
            }
            continue;
          }

          await this.saveReply(payload.messenger_id, payload.platform, msg.url, {
            type: "audio",
            url: msg.url,
            request_id: requestId
          }, payload.business_id);
          logWithCorrelation(
            requestId,
            "OUTBOUND_RESPONSE",
            `platform=${payload.platform} messenger_id=${payload.messenger_id} type=audio url=${msg.url}`
          );
        } else {
          // text message — synthesize to speech when the user sent a voice message
          const replyText = msg.type === "text" ? msg.text : "";
          if (isVoiceMessage && adapter.sendAudio && replyText) {
            try {
              logWithCorrelation(requestId, "VOICE_TTS", `synthesizing reply for voice user`);
              const audioUrl = await synthesizeSpeech(replyText, requestId, payload.language);
              if (audioUrl) {
                const voiceSendResult = await adapter.sendAudio(payload.messenger_id, audioUrl, {
                  request_id: requestId
                });

                if (voiceSendResult.success) {
                  await this.saveReply(payload.messenger_id, payload.platform, replyText, {
                    type: "voice_reply",
                    audio_url: audioUrl,
                    request_id: requestId
                  }, payload.business_id);
                  logWithCorrelation(
                    requestId,
                    "OUTBOUND_RESPONSE",
                    `platform=${payload.platform} messenger_id=${payload.messenger_id} type=voice_reply audio_url=${audioUrl}`
                  );
                  continue;
                }

                logWithCorrelation(
                  requestId,
                  "DOWNSTREAM_ERROR",
                  `platform=${payload.platform} messenger_id=${payload.messenger_id} type=voice_reply detail="${voiceSendResult.error ?? "unknown error"}"`,
                  "error"
                );
              }
            } catch (err) {
              logWithCorrelation(
                requestId,
                "VOICE_TTS_ERROR",
                err instanceof Error ? err.message : String(err),
                "error"
              );
              // Fall through to send as text if TTS fails
            }
          }

          const textSendResult = await adapter.sendMessage(payload.messenger_id, replyText, {
            request_id: requestId
          });
          if (!textSendResult.success) {
            logWithCorrelation(
              requestId,
              "DOWNSTREAM_ERROR",
              `platform=${payload.platform} messenger_id=${payload.messenger_id} type=text detail="${textSendResult.error ?? "unknown error"}"`,
              "error"
            );
            continue;
          }

          await this.saveReply(payload.messenger_id, payload.platform, replyText, {
            request_id: requestId
          }, payload.business_id);
          logWithCorrelation(
            requestId,
            "OUTBOUND_RESPONSE",
            `platform=${payload.platform} messenger_id=${payload.messenger_id} type=text text="${replyText}"`
          );
        }
      }

      logWithCorrelation(
        requestId,
        "OUTBOUND_RESPONSE",
        `platform=${payload.platform} messenger_id=${payload.messenger_id} dispatched_count=${result.messages.length}`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logWithCorrelation(
        requestId,
        "ROUTING_ERROR",
        `failed to forward to routing agent: ${errorMessage}`,
        "error"
      );
      // Don't throw — the incoming message is already saved
    }
  }

  /**
   * Get conversation stats for a messenger
   */
  async getConversationStats(messenger_id: string, platform: string, business_id?: string) {
    const messages = await db
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.messenger_id, messenger_id),
          eq(schema.chatMessages.platform, platform),
          eq(schema.chatMessages.business_id, business_id || "biz_default")
        )
      );

    return {
      total_messages: messages.length,
      user_messages: messages.filter(m => m.is_from_user).length,
      ai_messages: messages.filter(m => !m.is_from_user).length,
      first_message: messages[0]?.created_at,
      last_message: messages[messages.length - 1]?.created_at
    };
  }
}

// Export singleton instance
export const messageOrchestrator = new MessageOrchestrator();
