
export type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost";

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "converted",
  "lost"
];

export type LanguageCode = "en" | "si" | "ta";
export type DetectedLanguageTag = "english" | "sinhala" | "tamil";

export interface PlatformCapabilities {
  quick_replies: boolean;
  url_buttons: boolean;
  lists: boolean;
  max_quick_replies: number | null;
}

export type AgentMessage =
  | { type: "text"; text: string }
  | {
      type: "interactive";
      text: string;
      quick_replies?: Array<{ label: string; value?: string }>;
    };

export interface ChatRequest {
  message: string;
  messenger_id: string;
  request_id?: string;
  platform?: string;
  business_id?: string;
  language?: LanguageCode | DetectedLanguageTag;
  language_tag?: DetectedLanguageTag;
  platform_capabilities?: PlatformCapabilities;
}

export interface ChatResponse {
  success: boolean;
  messages: AgentMessage[];
  escalated: boolean;
  leadId?: string;
  leadScore?: number;
  error?: string;
}

export interface ScoreSignals {
  source?: string;
  service_interest?: string;
  budget_range?: string;
  premium_interest?: boolean;
  appointment_booked?: boolean;
  escalated?: boolean;
}

export interface ScoreResult {
  score: number;
  reasons: string[];
}
