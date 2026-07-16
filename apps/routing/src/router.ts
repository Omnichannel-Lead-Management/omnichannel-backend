import { GoogleGenAI } from "@google/genai";
import { getRegisteredAgents, getAgent } from "./agents/registry";
import { isCircuitOpen, recordAgentFailure, recordAgentSuccess } from "./circuitBreaker";
import type {
  AgentForwardResult,
  AgentMessage,
  ChatHistoryEntry,
  ChatRequest,
  ChatResponse,
  DetectedLanguageTag,
  LanguageCode
} from "./types";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
const DOWNSTREAM_TIMEOUT_MS = 15_000;

type LogLevel = "info" | "warn" | "error";

function logWithRequestId(
  requestId: string,
  event: string,
  detail: string,
  level: LogLevel = "info"
): void {
  const line = `[REQ-${requestId}] ${new Date().toISOString()} ${event} ${detail}`;
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

function resolveRequestId(req: ChatRequest): string {
  if (typeof req.request_id === "string" && req.request_id.trim().length > 0) {
    return req.request_id.trim();
  }

  return crypto.randomUUID();
}

function normalizeLanguageTag(value: unknown): DetectedLanguageTag | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "english" || normalized === "en") return "english";
  if (normalized === "sinhala" || normalized === "si") return "sinhala";
  if (normalized === "tamil" || normalized === "ta") return "tamil";
  return null;
}

function detectLanguageTagFromText(text: string): DetectedLanguageTag {
  if (/[\u0D80-\u0DFF]/.test(text)) {
    return "sinhala";
  }

  if (/[\u0B80-\u0BFF]/.test(text)) {
    return "tamil";
  }

  return "english";
}

function resolveDetectedLanguageTag(req: ChatRequest): DetectedLanguageTag {
  const fromTag = normalizeLanguageTag(req.language_tag);
  if (fromTag) {
    return fromTag;
  }

  const fromLanguage = normalizeLanguageTag(req.language);
  if (fromLanguage) {
    return fromLanguage;
  }

  return detectLanguageTagFromText(req.message);
}

function languageTagToCode(tag: DetectedLanguageTag): LanguageCode {
  if (tag === "sinhala") return "si";
  if (tag === "tamil") return "ta";
  return "en";
}

function getAgentFallbackText(req: ChatRequest, agentName: string): string {
  const languageTag = resolveDetectedLanguageTag(req);

  if (languageTag === "sinhala") {
    return "කරුණාකර ටිකක් ඉවසන්න, දැන් සේවාවට ළඟාවීමට ගැටලුවක් ඇත.";
  }

  if (languageTag === "tamil") {
    return "சற்று நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.";
  }

  return `I'm having trouble reaching our ${agentName} service right now. Please try again in a moment.`;
}

function buildFallbackForwardResult(req: ChatRequest, agentName: string): AgentForwardResult {
  return {
    escalated: false,
    messages: [{ type: "text", text: getAgentFallbackText(req, agentName) }]
  };
}

function buildClassificationPrompt(agents: ReturnType<typeof getRegisteredAgents>): string {
  const agentDescriptions = agents
    .map((a) => `- "${a.name}": ${a.description}`)
    .join("\n");

  return `You are a routing agent for the e-commerce assistant system. Your job is to analyze a user's conversation and determine which specialist agent should handle the latest message.

Detect the language of the user's message. Tag the detected language as one of: 'sinhala', 'tamil', 'english'. Include the detected language in the routing metadata you return.

Available agents:
${agentDescriptions}

Given the conversation history and the latest user message, you must:
1. Identify the user's intent
2. Choose the most appropriate agent
3. Write a clear, self-contained summary of what the user wants (as if starting fresh — include all relevant context from history)

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "agent": "<agent name from the list above>",
  "summary": "<self-contained query for the target agent, incorporating context from history>",
  "reasoning": "<one sentence explaining why you chose this agent>",
  "language": "<one of: sinhala | tamil | english>"
}`;
}

/** Normalize ChatHistoryEntry[] (orchestrator format) to role/content lines for the prompt */
function formatHistory(history: ChatHistoryEntry[]): string {
  return history
    .map((m) => `${m.is_from_user ? "User" : "Assistant"}: ${m.text}`)
    .join("\n");
}

interface RoutingDecision {
  agent: string;
  summary: string;
  reasoning: string;
  language: DetectedLanguageTag;
}

async function classifyIntent(req: ChatRequest): Promise<RoutingDecision> {
  const agents = getRegisteredAgents();
  const systemPrompt = buildClassificationPrompt(agents);

  const historySection =
    req.history && req.history.length > 0
      ? `\nConversation history:\n${formatHistory(req.history)}\n`
      : "";

  const userContent = `${historySection}\nLatest user message: ${req.message}`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: userContent }] }],
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
    },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

  try {
    const parsed = JSON.parse(text) as Partial<RoutingDecision>;

    const agentName = typeof parsed.agent === "string" ? parsed.agent : "product";
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary
        : req.message;
    const reasoning =
      typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0
        ? parsed.reasoning
        : "Fallback: routing reason not provided";
    const language = normalizeLanguageTag(parsed.language) ?? resolveDetectedLanguageTag(req);

    if (!getAgent(agentName)) {
      console.warn(`[router] unknown agent "${agentName}", defaulting to product`);
      return {
        agent: "product",
        summary,
        reasoning,
        language
      };
    }

    return {
      agent: agentName,
      summary,
      reasoning,
      language
    };
  } catch {
    console.warn("[router] failed to parse routing decision, defaulting to product");
    return {
      agent: "product",
      summary: req.message,
      reasoning: "Fallback: could not parse routing decision",
      language: resolveDetectedLanguageTag(req),
    };
  }
}

async function forwardToAgent(
  agentName: string,
  summary: string,
  req: ChatRequest
): Promise<AgentForwardResult> {
  const requestId = resolveRequestId(req);
  const languageTag = resolveDetectedLanguageTag(req);
  const agent = getAgent(agentName);
  if (!agent) throw new Error(`Agent "${agentName}" not found`);

  if (isCircuitOpen(agentName)) {
    logWithRequestId(
      requestId,
      "CIRCUIT_OPEN",
      `agent=${agentName} action=skip_downstream_call`,
      "warn"
    );
    return buildFallbackForwardResult(req, agentName);
  }

  const body = agent.buildRequest(summary, req);
  const endpoint = `${agent.url}${agent.chatPath}`;

  logWithRequestId(
    requestId,
    "ROUTING_DECISION",
    `agent=${agentName} action=forward endpoint=${endpoint}`
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, DOWNSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        "X-User-Language": languageTag
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text();
      const failureState = recordAgentFailure(agentName);
      logWithRequestId(
        requestId,
        "DOWNSTREAM_ERROR",
        `agent=${agentName} status=${res.status} failure_count=${failureState.failureCount}`,
        "error"
      );

      if (failureState.circuitOpened) {
        logWithRequestId(
          requestId,
          "CIRCUIT_OPEN",
          `agent=${agentName} failures_in_60s=${failureState.failureCount} open_for_ms=30000`,
          "warn"
        );
      }

      const fallback = buildFallbackForwardResult(req, agentName);
      if (text.length > 0) {
        logWithRequestId(
          requestId,
          "DOWNSTREAM_ERROR_DETAIL",
          `agent=${agentName} detail=${text.slice(0, 300)}`,
          "warn"
        );
      }
      return fallback;
    }

    const raw = await res.json();
    recordAgentSuccess(agentName);
    return agent.parseResponse(raw);
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const failureState = recordAgentFailure(agentName);

    if (isTimeout) {
      logWithRequestId(
        requestId,
        "DOWNSTREAM_TIMEOUT",
        `agent=${agentName} timeout_ms=${DOWNSTREAM_TIMEOUT_MS}`,
        "error"
      );
    } else {
      const message = error instanceof Error ? error.message : String(error);
      logWithRequestId(
        requestId,
        "DOWNSTREAM_ERROR",
        `agent=${agentName} failure_count=${failureState.failureCount} detail=${message}`,
        "error"
      );
    }

    if (failureState.circuitOpened) {
      logWithRequestId(
        requestId,
        "CIRCUIT_OPEN",
        `agent=${agentName} failures_in_60s=${failureState.failureCount} open_for_ms=30000`,
        "warn"
      );
    }

    return buildFallbackForwardResult(req, agentName);
  } finally {
    clearTimeout(timeout);
  }
}

function buildGreetingResponse(req: ChatRequest): AgentMessage[] {
  const languageTag = resolveDetectedLanguageTag(req);
  const name = req.user_info?.first_name;

  const text =
    languageTag === "sinhala"
      ? `${name ? `ආයුබෝවන්, ${name}!` : "ආයුබෝවන්!"} අපගේ සේවාවට සාදරයෙන් පිළිගනිමු. අද ඔබට මම කෙසේ උදව් කළ හැකිද?`
      : languageTag === "tamil"
        ? `${name ? `வணக்கம், ${name}!` : "வணக்கம்!"} எங்கள் சேவைக்கு வரவேற்கிறோம். இன்று நான் எப்படி உதவலாம்?`
        : `${name ? `Hello, ${name}!` : "Hello!"} Welcome! How can I assist you today?`;

  const quickReplies =
    languageTag === "sinhala"
      ? [
          { label: "සේවා ගැන විමසන්න", value: "Service Information" },
          { label: "හමුවීමක් වෙන්කරවා ගන්න", value: "Book Appointment" },
          { label: "සහාය අවශ්‍යයි", value: "Get Support" },
        ]
      : languageTag === "tamil"
        ? [
            { label: "சேவைகள் பற்றி", value: "Service Information" },
            { label: "சந்திப்பு பதிவு செய்க", value: "Book Appointment" },
            { label: "உதவி தேவை", value: "Get Support" },
          ]
        : [
            { label: "Service Information", value: "Service Information" },
            { label: "Book Appointment", value: "Book Appointment" },
            { label: "Get Support", value: "Get Support" },
          ];

  const caps = req.platform_capabilities;

  if (caps?.quick_replies) {
    // Respect platform button limit
    const limited =
      caps.max_quick_replies !== null
        ? quickReplies.slice(0, caps.max_quick_replies)
        : quickReplies;

    return [
      {
        type: "interactive",
        text,
        quick_replies: limited,
      },
    ];
  }

  const fallbackText =
    languageTag === "sinhala"
      ? `${text} සේවා විමසීම්, හමුවීම් පහසුකම්, සහ ඔබගේ අවශ්‍යතා සම්බන්ධයෙන් මට ඔබට උදව් කළ හැකිය.`
      : languageTag === "tamil"
        ? `${text} சேவைகள் பற்றிய விசாரணைகள், சந்திப்புகள், மற்றும் உங்கள் தேவைகளில் நான் உதவ முடியும்.`
        : `${text} I can assist you with service inquiries, booking appointments, or addressing any questions you may have.`;

  return [{ type: "text", text: fallbackText }];
}

export async function route(req: ChatRequest): Promise<ChatResponse> {
  const requestId = resolveRequestId(req);
  const requestedLanguageTag =
    normalizeLanguageTag(req.language_tag) ?? normalizeLanguageTag(req.language);
  const detectedFromText = detectLanguageTagFromText(req.message);
  const defaultLanguageTag = requestedLanguageTag ?? detectedFromText;
  req.request_id = requestId;
  req.language_tag = defaultLanguageTag;
  req.language = languageTagToCode(defaultLanguageTag);

  try {
    // Skip image handling for Lead Management system
    // Images can be processed if needed by specific agents

    logWithRequestId(
      requestId,
      "ROUTING_DECISION",
      `action=classify message="${req.message.slice(0, 80)}"`
    );

    const decision = await classifyIntent(req);
    const finalLanguageTag =
      defaultLanguageTag !== "english"
        ? defaultLanguageTag
        : decision.language;

    if (finalLanguageTag !== decision.language) {
      logWithRequestId(
        requestId,
        "ROUTING_DECISION",
        `language_override classifier=${decision.language} enforced=${finalLanguageTag}`
      );
    }

    req.language_tag = finalLanguageTag;
    req.language = languageTagToCode(finalLanguageTag);

    logWithRequestId(
      requestId,
      "ROUTING_DECISION",
      `chosen_agent=${decision.agent} language=${finalLanguageTag} reason="${decision.reasoning}"`
    );

    // Handle greetings and small talk locally — no downstream agent needed
    if (decision.agent === "general") {
      return {
        success: true,
        agent: "general",
        messages: buildGreetingResponse(req),
        escalated: false,
        routing: {
          intent: "general",
          summary: decision.summary,
          reasoning: decision.reasoning,
          language: finalLanguageTag,
        },
      };
    }

    const { messages, escalated } = await forwardToAgent(decision.agent, decision.summary, req);

    return {
      success: true,
      agent: decision.agent,
      messages,
      escalated,
      routing: {
        intent: decision.agent,
        summary: decision.summary,
        reasoning: decision.reasoning,
        language: finalLanguageTag,
      },
    };
  } catch (error) {
    logWithRequestId(
      requestId,
      "ROUTING_ERROR",
      error instanceof Error ? error.message : String(error),
      "error"
    );
    return {
      success: false,
      agent: "unknown",
      messages: [
        {
          type: "text" as const,
          text:
            error instanceof Error
              ? `Sorry, I encountered an error: ${error.message}`
              : "Sorry, I encountered an unexpected error.",
        },
      ],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
