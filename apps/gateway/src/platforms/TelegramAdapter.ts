import type { PlatformAdapter, PlatformCapabilities, AgentMessage } from "./PlatformAdapter";
import {
  CORRELATION_ID_HEADER,
  extractRequestId,
  generateCorrelationId
} from "../middleware/correlationId";

export class TelegramAdapter implements PlatformAdapter {
  readonly name = "telegram";

  readonly capabilities: PlatformCapabilities = {
    quick_replies: true,
    url_buttons: true,
    lists: false,
    max_quick_replies: null
  };

  private botToken: string;
  private apiUrl: string;

  constructor(botToken?: string) {
    this.botToken = botToken || process.env.TELEGRAM_BOT_TOKEN || "";
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;

    if (!this.botToken) {
      console.warn("⚠️  Telegram bot token not configured. Telegram adapter will not work.");
    }
  }

  /** Send a plain text message */
  async sendMessage(
    messenger_id: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: "Telegram bot token not configured" };
    }

    try {
      const requestId = extractRequestId(metadata) ?? generateCorrelationId();
      const chat_id = messenger_id.replace(/^tg_/, "");

      const body: Record<string, unknown> = {
        chat_id,
        text: message,
        parse_mode: "HTML"
      };

      if (metadata?.keyboard) {
        body.reply_markup = {
          keyboard: metadata.keyboard,
          resize_keyboard: true,
          one_time_keyboard: false
        };
      }

      if (metadata?.inline_keyboard) {
        body.reply_markup = { inline_keyboard: metadata.inline_keyboard };
      }

      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [CORRELATION_ID_HEADER]: requestId },
        body: JSON.stringify(body)
      });

      const result = await response.json() as { ok: boolean; description?: string };
      if (!result.ok) throw new Error(result.description || "Telegram API error");

      console.log(`✅ Telegram message sent to ${chat_id}`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Failed to send Telegram message:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /** Acknowledge an inline keyboard callback query */
  async answerCallbackQuery(
    callbackQueryId: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: "Telegram bot token not configured" };
    }

    try {
      const requestId = extractRequestId(metadata) ?? generateCorrelationId();
      const response = await fetch(`${this.apiUrl}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [CORRELATION_ID_HEADER]: requestId },
        body: JSON.stringify({ callback_query_id: callbackQueryId })
      });

      const result = await response.json() as { ok: boolean; description?: string };
      if (!result.ok) {
        throw new Error(result.description || "Telegram API error");
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMsg };
    }
  }

  /** Send an interactive message (reply keyboard for quick replies, inline for URL buttons) */
  async sendInteractive(
    messenger_id: string,
    message: Extract<AgentMessage, { type: "interactive" }>,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: "Telegram bot token not configured" };
    }

    try {
      const requestId = extractRequestId(metadata) ?? generateCorrelationId();
      const chat_id = messenger_id.replace(/^tg_/, "");
      const hasQuickReplies = (message.quick_replies?.length ?? 0) > 0;
      const hasUrlButtons = (message.url_buttons?.length ?? 0) > 0;

      if (hasQuickReplies && !hasUrlButtons) {
        const keyboard: Array<Array<{ text: string }>> = [];
        const chunk = 2;
        for (let i = 0; i < (message.quick_replies?.length ?? 0); i += chunk) {
          const row = (message.quick_replies ?? []).slice(i, i + chunk)
            .map(btn => ({ text: btn.label.trim() }))
            .filter(btn => btn.text.length > 0);
          if (row.length > 0) {
            keyboard.push(row);
          }
        }

        const body: Record<string, unknown> = {
          chat_id,
          text: message.text,
          parse_mode: "HTML"
        };

        if (keyboard.length > 0) {
          body.reply_markup = {
            keyboard,
            resize_keyboard: true,
            one_time_keyboard: true
          };
        }

        const response = await fetch(`${this.apiUrl}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json", [CORRELATION_ID_HEADER]: requestId },
          body: JSON.stringify(body)
        });

        const result = await response.json() as { ok: boolean; description?: string };
        if (!result.ok) throw new Error(result.description || "Telegram API error");

        console.log(`✅ Telegram interactive message sent to ${chat_id}`);
        return { success: true };
      }

      const rows: Record<string, unknown>[][] = [];

      if (message.quick_replies?.length) {
        const chunk = 2;
        for (let i = 0; i < message.quick_replies.length; i += chunk) {
          rows.push(
            message.quick_replies.slice(i, i + chunk).map(btn => ({
              text: btn.label,
              callback_data: (btn.value ?? btn.label).slice(0, 64)
            }))
          );
        }
      }

      if (message.url_buttons?.length) {
        for (const btn of message.url_buttons) {
          rows.push([{ text: btn.label, url: btn.url }]);
        }
      }

      const body: Record<string, unknown> = {
        chat_id,
        text: message.text,
        parse_mode: "HTML"
      };

      if (rows.length > 0) {
        body.reply_markup = { inline_keyboard: rows };
      }

      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [CORRELATION_ID_HEADER]: requestId },
        body: JSON.stringify(body)
      });

      const result = await response.json() as { ok: boolean; description?: string };
      if (!result.ok) throw new Error(result.description || "Telegram API error");

      console.log(`✅ Telegram interactive message sent to ${chat_id}`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Failed to send Telegram interactive message:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /** Send a photo via URL */
  async sendPhoto(
    messenger_id: string,
    url: string,
    caption?: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: "Telegram bot token not configured" };
    }

    try {
      const requestId = extractRequestId(metadata) ?? generateCorrelationId();
      const chat_id = messenger_id.replace(/^tg_/, "");

      const body: Record<string, unknown> = { chat_id, photo: url };
      if (caption) body.caption = caption;

      const response = await fetch(`${this.apiUrl}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [CORRELATION_ID_HEADER]: requestId },
        body: JSON.stringify(body)
      });

      const result = await response.json() as { ok: boolean; description?: string };
      if (!result.ok) throw new Error(result.description || "Telegram API error");

      console.log(`✅ Telegram photo sent to ${chat_id}`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Failed to send Telegram photo:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /** Send a voice message via URL */
  async sendAudio(
    messenger_id: string,
    url: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken) {
      return { success: false, error: "Telegram bot token not configured" };
    }

    const requestId = extractRequestId(metadata) ?? generateCorrelationId();
    const chat_id = messenger_id.replace(/^tg_/, "");

    const inferFilenameFromUrl = (sourceUrl: string): string => {
      try {
        const path = new URL(sourceUrl).pathname;
        const fromPath = path.split("/").pop()?.trim();
        if (fromPath) {
          return fromPath;
        }
      } catch {
      }
      return `voice_${Date.now()}.mp3`;
    };

    const parseTelegramApiResponse = async (response: Response): Promise<void> => {
      const raw = await response.text();

      let parsed: { ok?: boolean; description?: string } = {};
      try {
        parsed = JSON.parse(raw) as { ok?: boolean; description?: string };
      } catch {
        parsed = {};
      }

      if (!response.ok || parsed.ok !== true) {
        const detail = parsed.description || raw || `status=${response.status}`;
        throw new Error(detail);
      }
    };

    const sendViaEndpoint = async (
      endpoint: "sendVoice" | "sendAudio",
      body: Record<string, unknown>
    ): Promise<void> => {
      const response = await fetch(`${this.apiUrl}/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CORRELATION_ID_HEADER]: requestId
        },
        body: JSON.stringify(body)
      });
      await parseTelegramApiResponse(response);
    };

    const sendViaMultipart = async (
      endpoint: "sendVoice" | "sendAudio",
      fieldName: "voice" | "audio",
      data: Uint8Array,
      mimeType: string,
      filename: string
    ): Promise<void> => {
      const form = new FormData();
      form.append("chat_id", chat_id);
      form.append(
        fieldName,
        new Blob([data], { type: mimeType || "application/octet-stream" }),
        filename
      );

      const response = await fetch(`${this.apiUrl}/${endpoint}`, {
        method: "POST",
        headers: { [CORRELATION_ID_HEADER]: requestId },
        body: form
      });
      await parseTelegramApiResponse(response);
    };

    try {
      try {
        await sendViaEndpoint("sendVoice", { chat_id, voice: url });
        console.log(`✅ Telegram voice sent to ${chat_id}`);
        return { success: true };
      } catch (voiceError) {
        const voiceErrorMsg = voiceError instanceof Error ? voiceError.message : "Unknown error";
        console.warn(`⚠️ Telegram sendVoice failed for ${chat_id}: ${voiceErrorMsg}. Retrying as sendAudio.`);
      }

      await sendViaEndpoint("sendAudio", { chat_id, audio: url });
      console.log(`✅ Telegram audio sent to ${chat_id}`);
      return { success: true };
    } catch (urlSendError) {
      const urlSendErrorMsg = urlSendError instanceof Error ? urlSendError.message : "Unknown error";
      console.warn(`⚠️ Telegram URL audio send failed: ${urlSendErrorMsg}. Retrying with multipart upload.`);

      try {
        const audioResponse = await fetch(url, {
          headers: { [CORRELATION_ID_HEADER]: requestId }
        });

        if (!audioResponse.ok) {
          throw new Error(`Audio download failed with status ${audioResponse.status}`);
        }

        const mimeType =
          audioResponse.headers.get("content-type")?.split(";")[0].trim() ??
          "application/octet-stream";
        const filename = inferFilenameFromUrl(url);
        const data = new Uint8Array(await audioResponse.arrayBuffer());

        try {
          await sendViaMultipart("sendVoice", "voice", data, mimeType, filename);
          console.log(`✅ Telegram voice uploaded to ${chat_id}`);
          return { success: true };
        } catch (voiceUploadError) {
          const voiceUploadErrorMsg =
            voiceUploadError instanceof Error ? voiceUploadError.message : "Unknown error";
          console.warn(
            `⚠️ Telegram multipart sendVoice failed for ${chat_id}: ${voiceUploadErrorMsg}. Retrying as sendAudio.`
          );
        }

        await sendViaMultipart("sendAudio", "audio", data, mimeType, filename);
        console.log(`✅ Telegram audio uploaded to ${chat_id}`);
        return { success: true };
      } catch (finalError) {
        const errorMsg = finalError instanceof Error ? finalError.message : "Unknown error";
        console.error(`❌ Failed to send Telegram audio:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    }
  }

  /** Download a file from Telegram servers by file_id. */
  async downloadFile(
    fileId: string,
    requestId?: string
  ): Promise<{ data: Uint8Array; filename: string; mimeType: string } | null> {
    if (!this.botToken) return null;

    try {
      const correlationId = requestId || generateCorrelationId();

      const getFileRes = await fetch(`${this.apiUrl}/getFile?file_id=${fileId}`, {
        headers: { [CORRELATION_ID_HEADER]: correlationId }
      });
      const getFileData = (await getFileRes.json()) as {
        ok: boolean;
        result?: { file_path: string };
      };

      if (!getFileData.ok || !getFileData.result?.file_path) {
        console.error("[telegram] getFile failed:", getFileData);
        return null;
      }

      const filePath = getFileData.result.file_path;
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "jpg";
      const mimeType =
        ext === "oga" ? "audio/ogg" :
        ext === "opus" ? "audio/ogg" :
        ext === "ogg" ? "audio/ogg" :
        ext === "mp3" ? "audio/mpeg" :
        ext === "m4a" ? "audio/mp4" :
        ext === "aac" ? "audio/aac" :
        ext === "amr" ? "audio/amr" :
        ext === "wav" ? "audio/wav" :
        ext === "png" ? "image/png" :
        ext === "gif" ? "image/gif" :
        ext === "webp" ? "image/webp" :
        ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
        "application/octet-stream";

      const fileRes = await fetch(
        `https://api.telegram.org/file/bot${this.botToken}/${filePath}`,
        { headers: { [CORRELATION_ID_HEADER]: correlationId } }
      );

      if (!fileRes.ok) {
        console.error("[telegram] file download failed:", fileRes.status);
        return null;
      }

      const buffer = await fileRes.arrayBuffer();
      return {
        data: new Uint8Array(buffer),
        filename: `tg_${Date.now()}.${ext}`,
        mimeType
      };
    } catch (err) {
      console.error("[telegram] downloadFile error:", err);
      return null;
    }
  }

  async initialize(): Promise<void> {
    if (!this.botToken) {
      console.log("⏭️  Skipping Telegram initialization (no token)");
      return;
    }

    try {
      const response = await fetch(`${this.apiUrl}/getMe`);
      const result = await response.json() as { ok: boolean; result?: { username?: string } };

      if (result.ok) {
        console.log(`✅ Telegram bot connected: @${result.result?.username || "unknown"}`);
      } else {
        console.error("❌ Invalid Telegram bot token");
      }
    } catch (error) {
      console.error("❌ Failed to initialize Telegram:", error);
    }
  }

  validateMessengerId(messenger_id: string): boolean {
    return /^tg_\d+$/.test(messenger_id);
  }
}

/** Helper function to format Telegram webhook payload to standard format. */
export function formatTelegramWebhook(update: any) {
  const callbackQuery = update?.callback_query;
  if (callbackQuery) {
    const from = callbackQuery.from;
    const callbackMessage = callbackQuery.message;
    const callbackData = typeof callbackQuery.data === "string" ? callbackQuery.data.trim() : "";

    if (!from || !callbackData) {
      return null;
    }

    const result: Record<string, unknown> = {
      platform: "telegram",
      messenger_id: `tg_${from.id}`,
      message: callbackData,
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
      language: from.language_code || "en",
      metadata: {
        chat_type: callbackMessage?.chat?.type,
        message_id: callbackMessage?.message_id,
        date: callbackMessage?.date,
        type: "callback_query",
        callback_query_id: callbackQuery.id
      }
    };

    if (callbackMessage?.text) {
      result.replied_to = {
        text: callbackMessage.text,
        is_from_user: callbackMessage.from?.is_bot !== true
      };
    }

    return result;
  }

  const message = update.message;
  if (!message) return null;

  if (!message.text && !message.photo && !message.voice && !message.audio) return null;

  const from = message.from;
  const chat = message.chat;

  const result: Record<string, unknown> = {
    platform: "telegram",
    messenger_id: `tg_${from.id}`,
    message: message.text || message.caption || "",
    first_name: from.first_name,
    last_name: from.last_name,
    username: from.username,
    language: from.language_code || "en",
    metadata: {
      chat_type: chat.type,
      message_id: message.message_id,
      date: message.date
    }
  };

  if (message.reply_to_message) {
    const replied = message.reply_to_message;
    const repliedText: string = replied.text || replied.caption || "";
    if (repliedText) {
      result.replied_to = {
        text: repliedText,
        is_from_user: replied.from?.is_bot !== true
      };
    }
  }

  const caption = typeof message.caption === "string" ? message.caption : "";

  if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1] as { file_id: string };
    result._photo_file_id = largest.file_id;
    result._caption = caption;
    if (!message.text) result.message = caption || "[Photo]";
  }

  if (message.voice?.file_id) {
    result._audio_file_id = message.voice.file_id;
    result._caption = caption;
    result.message = caption || "[Voice Message]";
  } else if (message.audio?.file_id) {
    result._audio_file_id = message.audio.file_id;
    result._caption = caption;
    result.message = caption || "[Audio Message]";
  }

  return result;
}
