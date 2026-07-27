import type {
  AgentConfig,
  AgentForwardResult,
  AgentMessage,
  ChatRequest,
  DetectedLanguageTag,
  LanguageCode,
  PlatformCapabilities
} from "../types";

const DEFAULT_CAPABILITIES: PlatformCapabilities = {
  quick_replies: false,
  url_buttons: false,
  lists: false,
  max_quick_replies: null,
};

const LEAD_MANAGER_URL      = process.env.LEAD_MANAGER_URL      ?? "http://localhost:3002";
const CHATBOT_ENGINE_URL    = process.env.CHATBOT_ENGINE_URL    ?? "http://localhost:3003";
const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL ?? "http://localhost:3005";

/**
 * Shared response shape returned by all downstream agents.
 */
interface DownstreamResponse {
  success: boolean;
  messages?: AgentMessage[];
}

/**
 * Default parseResponse — all downstream agents return { success, messages, escalated? }.
 * Falls back gracefully for agents that haven't adopted the unified protocol yet.
 */
function defaultParseResponse(raw: unknown): AgentForwardResult {
  const r = raw as DownstreamResponse & { escalated?: boolean };
  const messages: AgentMessage[] =
    Array.isArray(r?.messages) && r.messages.length > 0
      ? r.messages
      : [{ type: "text", text: typeof raw === "string" ? raw : JSON.stringify(raw) }];
  return { messages, escalated: r?.escalated === true };
}

function normalizeLanguageTag(value: unknown): DetectedLanguageTag | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "english" || normalized === "en") {
    return "english";
  }
  if (normalized === "sinhala" || normalized === "si") {
    return "sinhala";
  }
  if (normalized === "tamil" || normalized === "ta") {
    return "tamil";
  }

  return null;
}

function languageTagToCode(tag: DetectedLanguageTag): LanguageCode {
  if (tag === "sinhala") return "si";
  if (tag === "tamil") return "ta";
  return "en";
}

function resolveLanguageTag(req: ChatRequest): DetectedLanguageTag {
  const fromTag = normalizeLanguageTag(req.language_tag);
  if (fromTag) return fromTag;

  const fromLanguage = normalizeLanguageTag(req.language);
  if (fromLanguage) return fromLanguage;

  return "english";
}

function resolveLanguageCode(req: ChatRequest): LanguageCode {
  const language = req.language;

  if (language === "en" || language === "si" || language === "ta") {
    return language;
  }

  return languageTagToCode(resolveLanguageTag(req));
}

/**
 * Central agent registry for Lead Management Platform.
 * To add a new agent: add an entry here and set its env var for the URL.
 * All agents must expose POST /chat accepting { message, messenger_id, language? }
 * and returning { success, messages: AgentMessage[] }.
 *
 * Special agent "general" is handled locally in the router — it has no URL.
 */
export const agentRegistry: Record<string, AgentConfig> = {
  general: {
    name: "general",
    description:
      "Handles general greetings, small talk, and simple conversational messages that do not relate to service inquiries or appointments (e.g. 'hi', 'hello', 'how are you', 'thanks', 'bye', 'what can you do').",
    url: "",
    chatPath: "",
    buildRequest(summary, req) {
      return { message: summary, messenger_id: req.messenger_id };
    },
    parseResponse: defaultParseResponse,
  },

  service_inquiry: {
    name: "service_inquiry",
    description:
      "Handles queries about services offered by businesses: pricing information, service availability, business hours, location, service features, comparing service packages, general business information. Routes to chatbot engine for automated responses.",
    url: CHATBOT_ENGINE_URL,
    chatPath: "/chat",
    buildRequest(summary, req) {
      return {
        message: summary,
        messenger_id: req.messenger_id,
        business_id: req.business_id,
        language: resolveLanguageCode(req),
        language_tag: resolveLanguageTag(req),
        platform_capabilities: req.platform_capabilities ?? DEFAULT_CAPABILITIES,
      };
    },
    parseResponse: defaultParseResponse,
  },

  appointment_booking: {
    name: "appointment_booking",
    description:
      "Handles appointment-related requests: scheduling appointments, checking availability, viewing booked appointments, rescheduling, cancelling appointments, setting reminders.",
    url: APPOINTMENT_SERVICE_URL,
    chatPath: "/chat",
    buildRequest(summary, req) {
      return {
        message: summary,
        messenger_id: req.messenger_id,
        business_id: req.business_id,
        language: resolveLanguageCode(req),
        language_tag: resolveLanguageTag(req),
        platform_capabilities: req.platform_capabilities ?? DEFAULT_CAPABILITIES,
      };
    },
    parseResponse: defaultParseResponse,
  },

  lead_qualification: {
    name: "lead_qualification",
    description:
      "Handles lead qualification and customer support: collecting customer information, answering detailed questions about services, handling specific inquiries that require human agent escalation, managing customer complaints or concerns, providing quotes or estimates.",
    url: LEAD_MANAGER_URL,
    chatPath: "/chat",
    buildRequest(summary, req) {
      return {
        message: summary,
        messenger_id: req.messenger_id,
        business_id: req.business_id,
        language: resolveLanguageCode(req),
        language_tag: resolveLanguageTag(req),
        platform_capabilities: req.platform_capabilities ?? DEFAULT_CAPABILITIES,
      };
    },
    parseResponse: defaultParseResponse,
  },
};

export function getRegisteredAgents(): AgentConfig[] {
  return Object.values(agentRegistry);
}

export function getDownstreamAgentNames(): string[] {
  return getRegisteredAgents()
    .filter((agent) => Boolean(agent.url) && Boolean(agent.chatPath))
    .map((agent) => agent.name);
}

export function getAgent(name: string): AgentConfig | undefined {
  return agentRegistry[name];
}
