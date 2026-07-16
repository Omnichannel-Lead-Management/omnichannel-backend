/** Entry in the conversation history as stored by the orchestrator */
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
  /** Correlation ID propagated from orchestrator (X-Request-ID) */
  request_id?: string;
  /** Platform-specific user identifier (e.g. "tg_123456") */
  messenger_id: string;
  /** Source platform name */
  platform?: string;
  language?: LanguageCode | DetectedLanguageTag;
  language_tag?: DetectedLanguageTag;
  /** Publicly accessible URL of an image the user sent — triggers photo agent */
  image_url?: string;
  /** Accepts either orchestrator format or role/content format */
  history?: ChatHistoryEntry[];
  user_info?: {
    first_name?: string;
    last_name?: string;
    username?: string;
    phone?: string;
    linked_user_id?: string | null;
  };
  /** Interactive features supported by the originating platform */
  platform_capabilities?: PlatformCapabilities;
}

/** A single message in the agent's response */
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
  /** Path of the chat endpoint, e.g. "/chat" or "/api/order-chat" */
  chatPath: string;
  /** Transform the outgoing request body for this agent */
  buildRequest: (summary: string, req: ChatRequest) => Record<string, unknown>;
  /** Normalize the agent's raw response into messages + escalation flag */
  parseResponse: (raw: unknown) => AgentForwardResult;
}
