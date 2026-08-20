export interface ChatHistoryEntry {
  is_from_user: boolean;
  text: string;
  timestamp: string;
}

export type LanguageCode = "en" | "si" | "ta";
export type DetectedLanguageTag = "english" | "sinhala" | "tamil";

export interface PlatformCapabilities {
  quick_replies: boolean;
  url_buttons: boolean;
  lists: boolean;
  max_quick_replies: number | null;
}

export interface ChatRequest {
  message: string;
  request_id?: string;
  business_id?: string;
  messenger_id: string;
  platform?: string;
  language?: LanguageCode | DetectedLanguageTag;
  language_tag?: DetectedLanguageTag;
  image_url?: string;
  history?: ChatHistoryEntry[];
  user_info?: {
    first_name?: string;
    last_name?: string;
    username?: string;
    phone?: string;
    linked_user_id?: string | null;
  };
  platform_capabilities?: PlatformCapabilities;
}

export type AgentMessage =
  | { type: "text"; text: string }
  | { type: "photo"; url: string; caption?: string }
  | { type: "audio"; url: string }
  | {
      type: "interactive";
      text: string;
      quick_replies?: Array<{ label: string; value?: string }>;
      url_buttons?: Array<{ label: string; url: string }>;
      list?: {
        button_label: string;
        sections: Array<{
          title: string;
          items: Array<{ id: string; title: string; description?: string }>;
        }>;
      };
    };

export interface ChatResponse {
  success: boolean;
  agent: string;
  messages: AgentMessage[];
  escalated?: boolean;
  escalation_tag?: string;
  escalation_summary?: string;
  routing?: {
    intent: string;
    summary: string;
    reasoning: string;
    language: DetectedLanguageTag;
  };
  error?: string;
}

export interface AgentForwardResult {
  messages: AgentMessage[];
  escalated: boolean;
}

export interface AgentConfig {
  name: string;
  description: string;
  url: string;
  chatPath: string;
  buildRequest: (summary: string, req: ChatRequest) => Record<string, unknown>;
  parseResponse: (raw: unknown) => AgentForwardResult;
}
