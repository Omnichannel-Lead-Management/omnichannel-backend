
export interface QuickReply {
  label: string;
  value?: string;
}

export interface UrlButton {
  label: string;
  url: string;
}

export interface ListItem {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title?: string;
  items: ListItem[];
}

export type AgentMessage =
  | { type: "text"; text: string }
  | { type: "photo"; url: string; caption?: string }
  | { type: "audio"; url: string }
  | {
      type: "interactive";
      text: string;
      quick_replies?: QuickReply[];
      url_buttons?: UrlButton[];
      list?: {
        button_label: string;
        sections: ListSection[];
      };
    };

export interface PlatformCapabilities {
  quick_replies: boolean;
  url_buttons: boolean;
  lists: boolean;
  max_quick_replies: number | null;
}

export interface PlatformAdapter {
  readonly name: string;

  readonly capabilities: PlatformCapabilities;

  sendMessage(
    messenger_id: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }>;

  sendPhoto?(
    messenger_id: string,
    url: string,
    caption?: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }>;

  sendAudio?(
    messenger_id: string,
    url: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }>;

  sendInteractive?(
    messenger_id: string,
    message: Extract<AgentMessage, { type: "interactive" }>,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }>;

  initialize?(): Promise<void>;

  validateMessengerId?(messenger_id: string): boolean;
}

export interface IncomingMessage {
  platform: string;
  request_id?: string;
  business_id?: string;
  messenger_id: string;
  message: string;
  image_url?: string;
  audio_url?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  phone?: string;
  language?: string;
  metadata?: Record<string, any>;
  replied_to?: {
    text: string;
    is_from_user: boolean;
  };
}

export interface ReplyMessage {
  platform: string;
  messenger_id: string;
  reply_text: string;
  metadata?: Record<string, any>;
}

export interface ChatHistoryEntry {
  is_from_user: boolean;
  text: string;
  timestamp: string;
}

export interface AIRequestPayload {
  request_id?: string;
  business_id?: string;
  messenger_id: string;
  platform: string;
  message: string;
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
  platform_capabilities: PlatformCapabilities;
  replied_to?: {
    text: string;
    is_from_user: boolean;
  };
}

export enum Platform {
  TELEGRAM = "telegram",
  WEB = "web",
  WHATSAPP = "whatsapp",
  FACEBOOK = "facebook"
}
