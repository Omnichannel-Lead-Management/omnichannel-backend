import { getGenAiClient, GEMINI_MODEL } from "../genaiClient";
import { utcToLocalDate } from "./business-hours";

/**
 * Turns a customer's booking message into structured fields.
 *
 * The routing service already rewrites each message into a self-contained
 * summary ("The user wants to book a haircut tomorrow at 3pm"), so a single
 * extraction pass is enough — this service never sees the raw history.
 *
 * Gemini does the work because customers write in English, Sinhala and Tamil
 * and phrase times freely. Anything it returns is re-validated here; the model
 * is never trusted to produce a well-formed date or time.
 */

export interface BookingDetails {
  /** "YYYY-MM-DD" in business-local time */
  date: string | null;
  /** "HH:MM" 24h in business-local time */
  time: string | null;
  service: string | null;
  customerName: string | null;
  /** Customer wants to cancel/reschedule rather than book */
  intent: "book" | "other";
}

const EMPTY: BookingDetails = {
  date: null,
  time: null,
  service: null,
  customerName: null,
  intent: "book"
};

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  // Reject impossible dates like 2026-02-31 that match the shape.
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function normalizeText(value: unknown, maxLength = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function buildPrompt(nowLocalDate: string): string {
  return `You extract appointment booking details from a customer message for a local business.

Today's date in the business's timezone is ${nowLocalDate}.

Resolve relative dates ("today", "tomorrow", "next Monday") against that date.
Interpret times as the business's local time, in 24-hour form.
Never invent a date or time the customer did not give — return null instead.

Respond ONLY with valid JSON in this exact shape (no markdown, no extra text):
{
  "intent": "book" | "other",
  "date": "<YYYY-MM-DD or null>",
  "time": "<HH:MM 24-hour, or null>",
  "service": "<service the customer named, or null>",
  "customer_name": "<name the customer gave, or null>"
}

Use "other" for cancelling, rescheduling or checking an existing booking.`;
}

export async function extractBookingDetails(
  message: string,
  now: Date = new Date()
): Promise<BookingDetails> {
  const ai = getGenAiClient();
  if (!ai) return { ...EMPTY };

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: message }] }],
      config: {
        systemInstruction: buildPrompt(utcToLocalDate(now)),
        responseMimeType: "application/json"
      }
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as Record<string, unknown>;

    return {
      date: normalizeDate(parsed.date),
      time: normalizeTime(parsed.time),
      service: normalizeText(parsed.service),
      customerName: normalizeText(parsed.customer_name, 60),
      intent: parsed.intent === "other" ? "other" : "book"
    };
  } catch (error) {
    console.warn(
      "[appointment] booking extraction failed:",
      error instanceof Error ? error.message : error
    );
    return { ...EMPTY };
  }
}
