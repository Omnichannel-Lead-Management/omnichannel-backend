// ─────────────────────────────────────────────────────────────────────────────
// Interactive message building blocks
// ─────────────────────────────────────────────────────────────────────────────

/** A button that sends a text reply when tapped */
export interface QuickReply {
  /** Text shown on the button */
  label: string;
  /** Text sent to the bot when clicked — defaults to label if omitted */
  value?: string;
}

/** A button that opens a URL */
export interface UrlButton {
  label: string;
  url: string;
}

/** A single row in a list section */
export interface ListItem {
  /** Unique identifier used as the reply value when selected */
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title?: string;
  items: ListItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent message union
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single message returned by the routing agent.
 *
 * interactive — rich message with optional buttons / list.
 *   The orchestrator will render it natively on platforms that support it,
 *   or fall back to plain text on those that do not.
 */
export type AgentMessage =
  | { type: "text"; text: string }
  | { type: "photo"; url: string; caption?: string }
  | { type: "audio"; url: string }
  | {
      type: "interactive";
      /** Main body text shown above buttons / list */
      text: string;
      /**
       * Quick-reply buttons (tap to send that label back as a text message).
       * Platforms: Telegram ✓ | WhatsApp ✓ (≤3) or list (>3) | Discord ✓ | Web ✓
       */
      quick_replies?: QuickReply[];
      /**
       * URL link buttons.
       * Platforms: Telegram ✓ | WhatsApp ✗ (falls back to text) | Discord ✓ | Web ✓
       */
      url_buttons?: UrlButton[];
      /**
       * Scrollable list of items (WhatsApp list message).
       * Platforms: Telegram ✗ (falls back to numbered list) | WhatsApp ✓ | Discord ✗ | Web ✓
       */
      list?: {
        /** Label on the button that opens the list */
        button_label: string;
        sections: ListSection[];
      };
    };

// ─────────────────────────────────────────────────────────────────────────────
// Platform capabilities (advertised to agents in every request)
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformCapabilities {
  /** Platform can render quick-reply buttons */
  quick_replies: boolean;
  /** Platform can render URL link buttons */
  url_buttons: boolean;
  /** Platform can render scrollable list messages */
  lists: boolean;
  /**
   * Maximum quick-reply buttons before the platform degrades to a list.
   * null means no practical limit.
   */
  max_quick_replies: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PlatformAdapter interface
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformAdapter {
  /** Platform name identifier */
  readonly name: string;

  /** What interactive features this platform natively supports */
  readonly capabilities: PlatformCapabilities;

  /** Send a plain text reply */
  sendMessage(
    messenger_id: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }>;

  /** Send a photo with optional caption */
  sendPhoto?(
    messenger_id: string,
    url: string,
    caption?: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }>;

  /** Send a voice/audio file */
  sendAudio?(
    messenger_id: string,
    url: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }>;

  /**
   * Send an interactive message (buttons / list).
   * If not implemented the orchestrator falls back to plain text.
   */
  sendInteractive?(
    messenger_id: string,
    message: Extract<AgentMessage, { type: "interactive" }>,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }>;

  /** Initialize the adapter (setup webhooks, connections, etc.) */
  initialize?(): Promise<void>;

  /** Validate if a messenger_id is valid for this platform */
  validateMessengerId?(messenger_id: string): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Other shared types
// ─────────────────────────────────────────────────────────────────────────────

/** Incoming message payload (standardised across all platforms) */
export interface IncomingMessage {
  platform: string;
  request_id?: string;
  messenger_id: string;
  message: string;
  /** Publicly accessible URL of an image the user sent (uploaded to storage) */
  image_url?: string;
  /** Publicly accessible URL of a voice/audio message the user sent (uploaded to storage) */
  audio_url?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  phone?: string;
  language?: string;
  metadata?: Record<string, any>;
  /** Context when the user replies to a previous message */
  replied_to?: {
    text: string;
    is_from_user: boolean;
  };
}

/** Reply payload from external AI */
export interface ReplyMessage {
  platform: string;
  messenger_id: string;
  reply_text: string;
  metadata?: Record<string, any>;
}

/** Chat history entry format for AI */
export interface ChatHistoryEntry {
  is_from_user: boolean;
  text: string;
  timestamp: string;
}

/** Payload sent to the external routing agent */
export interface AIRequestPayload {
  request_id?: string;
  messenger_id: string;
  platform: string;
  message: string;
  /** Publicly accessible URL of an image the user sent */
  image_url?: string;
  language: string;
  history: ChatHistoryEntry[];
  user_info: {
    first_name?: string;
    last_name?: string;
    username?: string;
    phone?: string;
    linked_user_id?: string;
  };
  /**
   * Describes what interactive features the current platform supports.
   * Agents should use this to decide whether to return interactive messages.
   */
  platform_capabilities: PlatformCapabilities;
  /** Present when the user replied to a previous message; contains that message's text */
  replied_to?: {
    text: string;
    is_from_user: boolean;
  };
}

/** Platform types enum */
export enum Platform {
  TELEGRAM = "telegram",
  WEB = "web",
  WHATSAPP = "whatsapp",
  FACEBOOK = "facebook"
}
