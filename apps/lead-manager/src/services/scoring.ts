import type { ScoreResult, ScoreSignals } from "../types";

interface ScoreRule {
  key: string;
  points: number;
  description: string;
  matches: (s: ScoreSignals) => boolean;
}

const PREMIUM_KEYWORDS = ["premium", "vip", "deluxe", "gold", "full package"];

export const SCORE_RULES: ScoreRule[] = [
  {
    key: "from_chatbot",
    points: 30,
    description: "Created from an automated chatbot conversation",
    matches: (s) => s.source === "chatbot"
  },
  {
    key: "instant_messaging_source",
    points: 10,
    description: "Arrived via WhatsApp or Telegram",
    matches: (s) => s.source === "whatsapp" || s.source === "telegram"
  },
  {
    key: "premium_interest",
    points: 20,
    description: "Expressed interest in a premium / booking option",
    matches: (s) =>
      s.premium_interest === true ||
      (typeof s.service_interest === "string" &&
        PREMIUM_KEYWORDS.some((k) => s.service_interest!.toLowerCase().includes(k)))
  },
  {
    key: "high_budget",
    points: 15,
    description: "Indicated a high budget range",
    matches: (s) => (s.budget_range ?? "").toLowerCase() === "high"
  },
  {
    key: "appointment_booked",
    points: 20,
    description: "Booked an appointment",
    matches: (s) => s.appointment_booked === true
  }
];

const MIN_SCORE = 0;
const MAX_SCORE = 100;

export function scoreLead(signals: ScoreSignals): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  for (const rule of SCORE_RULES) {
    if (rule.matches(signals)) {
      score += rule.points;
      reasons.push(`+${rule.points} ${rule.description}`);
    }
  }

  if (signals.escalated) {
    reasons.push("⚑ Escalated / complaint — flag for human follow-up");
  }

  const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
  return { score: clamped, reasons };
}

/** Derive scoring signals from a free-text message (best-effort keyword match). */
export function signalsFromMessage(message: string): Pick<ScoreSignals, "premium_interest"> {
  const lower = message.toLowerCase();
  return { premium_interest: PREMIUM_KEYWORDS.some((k) => lower.includes(k)) };
}
