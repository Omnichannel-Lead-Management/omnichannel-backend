export type Platform = "whatsapp" | "telegram" | "web";

export type LanguageCode = "en" | "si" | "ta";

export type DetectedLanguageTag = "english" | "sinhala" | "tamil";

export interface ChatHistoryEntry {
  is_from_user: boolean;
  text: string;
  timestamp: string;
}

export interface AgentMessage {
  type: "text" | "interactive";
  text: string;
  quick_replies?: Array<{ label: string; value: string }>;
}
