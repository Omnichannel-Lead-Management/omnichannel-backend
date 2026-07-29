import type { Database } from "bun:sqlite";
import { Elysia, t } from "elysia";
import {
  createAppointmentIfAvailable,
  getAvailableAppointmentSlots
} from "../services/appointment-service";
import { extractBookingDetails } from "../services/booking-parser";
import {
  defaultAppointmentMinutes,
  formatLocalTime,
  isWithinOpeningHours,
  localDateTimeToUtc,
  openingHoursLabel,
  utcToLocalDate
} from "../services/business-hours";

/**
 * Conversational booking endpoint called by the routing service.
 *
 * Routing forwards a self-contained summary plus the tenant's business_id; this
 * turns that into a real appointment row, or explains what it still needs. The
 * reply shape matches every other agent: { success, messages, escalated }.
 */

type LanguageTag = "english" | "sinhala" | "tamil";

interface QuickReply {
  label: string;
  value: string;
}

interface AgentMessage {
  type: "text" | "interactive";
  text: string;
  quick_replies?: QuickReply[];
}

const MAX_SLOT_SUGGESTIONS = 3;

function resolveLanguage(body: { language?: string; language_tag?: string }): LanguageTag {
  const raw = (body.language_tag ?? body.language ?? "").trim().toLowerCase();
  if (raw === "sinhala" || raw === "si") return "sinhala";
  if (raw === "tamil" || raw === "ta") return "tamil";
  return "english";
}

function pick(language: LanguageTag, english: string, sinhala: string, tamil: string): string {
  if (language === "sinhala") return sinhala;
  if (language === "tamil") return tamil;
  return english;
}

function askForDateTime(language: LanguageTag, missing: "date" | "time" | "both"): string {
  const hours = openingHoursLabel();

  if (missing === "time") {
    return pick(
      language,
      `What time would you like? We're open ${hours}.`,
      `ඔබට කැමති වේලාව කුමක්ද? අපි ${hours} විවෘතයි.`,
      `உங்களுக்கு எந்த நேரம் வேண்டும்? நாங்கள் ${hours} திறந்திருக்கிறோம்.`
    );
  }

  if (missing === "date") {
    return pick(
      language,
      "Which day would you like to come in?",
      "ඔබට එන්නට කැමති දිනය කුමක්ද?",
      "நீங்கள் எந்த நாள் வர விரும்புகிறீர்கள்?"
    );
  }

  return pick(
    language,
    `Sure — which day and time suit you? We're open ${hours}.`,
    `හොඳයි — ඔබට ගැළපෙන දිනය සහ වේලාව කුමක්ද? අපි ${hours} විවෘතයි.`,
    `சரி — உங்களுக்கு எந்த நாளும் நேரமும் வசதி? நாங்கள் ${hours} திறந்திருக்கிறோம்.`
  );
}

function buildMessage(
  text: string,
  quickReplies: QuickReply[],
  capabilities?: { quick_replies?: boolean; max_quick_replies?: number | null }
): AgentMessage {
  if (quickReplies.length === 0 || !capabilities?.quick_replies) {
    const inline = quickReplies.map((reply) => reply.label).join(", ");
    return { type: "text", text: inline ? `${text} ${inline}` : text };
  }

  const limit = capabilities.max_quick_replies ?? quickReplies.length;
  return { type: "interactive", text, quick_replies: quickReplies.slice(0, limit) };
}

function reply(messages: AgentMessage[], escalated = false) {
  return { success: true, messages, escalated };
}

export function createChatRoute(db: Database): Elysia {
  return new Elysia().post(
    "/chat",
    async ({ body }) => {
      const language = resolveLanguage(body);
      const businessId = body.business_id?.trim() || process.env.DEFAULT_BUSINESS_ID || "";

      if (!businessId) {
        return reply([
          {
            type: "text",
            text: pick(
              language,
              "I can't tell which business this booking is for. Please try again.",
              "මෙම වෙන්කිරීම කුමන ව්‍යාපාරය සඳහාද යන්න හඳුනාගත නොහැක. නැවත උත්සාහ කරන්න.",
              "இந்த முன்பதிவு எந்த வணிகத்திற்கானது எனத் தெரியவில்லை. மீண்டும் முயற்சிக்கவும்."
            )
          }
        ]);
      }

      const details = await extractBookingDetails(body.message);

      if (details.intent === "other") {
        return reply(
          [
            {
              type: "text",
              text: pick(
                language,
                "I can book a new appointment for you. For changes to an existing booking, let me connect you with our team.",
                "මට ඔබට නව හමුවීමක් වෙන්කර දිය හැක. දැනට ඇති වෙන්කිරීමක් වෙනස් කිරීමට, අපගේ කණ්ඩායම හා සම්බන්ධ කරන්නම්.",
                "நான் உங்களுக்கு புதிய சந்திப்பை பதிவு செய்ய முடியும். ஏற்கனவே உள்ள பதிவை மாற்ற, எங்கள் குழுவுடன் இணைக்கிறேன்."
              )
            }
          ],
          true
        );
      }

      if (!details.date || !details.time) {
        const missing = !details.date && !details.time ? "both" : !details.date ? "date" : "time";
        return reply([{ type: "text", text: askForDateTime(language, missing) }]);
      }

      const startUtc = localDateTimeToUtc(details.date, details.time);
      if (!startUtc) {
        return reply([{ type: "text", text: askForDateTime(language, "both") }]);
      }

      const endUtc = new Date(startUtc.getTime() + defaultAppointmentMinutes() * 60 * 1000);

      if (startUtc.getTime() <= Date.now()) {
        return reply([
          {
            type: "text",
            text: pick(
              language,
              "That time has already passed — could you pick a future date and time?",
              "එම වේලාව දැනටමත් ගෙවී ගොස් ඇත — කරුණාකර ඉදිරි දිනයක් සහ වේලාවක් තෝරන්න.",
              "அந்த நேரம் ஏற்கனவே கடந்துவிட்டது — வருங்கால தேதி மற்றும் நேரத்தைத் தேர்வுசெய்யவும்."
            )
          }
        ]);
      }

      if (!isWithinOpeningHours(startUtc, endUtc)) {
        return reply([
          {
            type: "text",
            text: pick(
              language,
              `We're only open ${openingHoursLabel()}. Could you pick a time inside those hours?`,
              `අපි විවෘත වන්නේ ${openingHoursLabel()} පමණි. එම වේලාවන් තුළ වේලාවක් තෝරන්න.`,
              `நாங்கள் ${openingHoursLabel()} மட்டுமே திறந்திருக்கிறோம். அந்த நேரத்திற்குள் ஒரு நேரத்தைத் தேர்வுசெய்யவும்.`
            )
          }
        ]);
      }

      const customerName =
        details.customerName ?? body.user_info?.first_name?.trim() ?? "Customer";
      const service = details.service ?? "Appointment";

      const outcome = createAppointmentIfAvailable(db, {
        businessId,
        customerName,
        customerPhone: body.user_info?.phone ?? null,
        service,
        startTime: startUtc.toISOString(),
        endTime: endUtc.toISOString(),
        notes: `Booked via ${body.platform ?? "chat"} (${body.messenger_id ?? "unknown"})`
      });

      if (outcome.result === "conflict") {
        const slots = getAvailableAppointmentSlots(db, businessId, utcToLocalDate(startUtc))
          .slice(0, MAX_SLOT_SUGGESTIONS)
          .map((slot) => {
            const label = formatLocalTime(new Date(slot.startTime));
            return { label, value: `${details.date} ${label}` };
          });

        const text =
          slots.length > 0
            ? pick(
                language,
                "That slot is already taken. These are free:",
                "එම වේලාව දැනටමත් වෙන්කර ඇත. මේවා නිදහස්ව ඇත:",
                "அந்த நேரம் ஏற்கனவே பதிவாகிவிட்டது. இவை காலியாக உள்ளன:"
              )
            : pick(
                language,
                "That slot is taken and the rest of that day is full. Could you try another day?",
                "එම වේලාව වෙන්කර ඇති අතර එදින සම්පූර්ණයෙන් පිරී ඇත. වෙනත් දිනයක් උත්සාහ කරන්න.",
                "அந்த நேரம் பதிவாகியுள்ளது, அந்த நாள் முழுவதும் நிரம்பிவிட்டது. வேறு நாளை முயற்சிக்கவும்."
              );

        return reply([buildMessage(text, slots, body.platform_capabilities)]);
      }

      const when = `${details.date} ${formatLocalTime(startUtc)}`;
      return reply([
        {
          type: "text",
          text: pick(
            language,
            `Booked — ${service} on ${when} for ${customerName}. See you then!`,
            `වෙන්කර ගන්නා ලදී — ${customerName} සඳහා ${when} දින ${service}. එදින හමුවෙමු!`,
            `பதிவு செய்யப்பட்டது — ${customerName} க்காக ${when} அன்று ${service}. அப்போது சந்திப்போம்!`
          )
        }
      ]);
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1 }),
        business_id: t.Optional(t.String()),
        messenger_id: t.Optional(t.String()),
        platform: t.Optional(t.String()),
        language: t.Optional(t.String()),
        language_tag: t.Optional(t.String()),
        user_info: t.Optional(
          t.Object({
            first_name: t.Optional(t.String()),
            last_name: t.Optional(t.String()),
            username: t.Optional(t.String()),
            phone: t.Optional(t.String())
          })
        ),
        platform_capabilities: t.Optional(
          t.Object({
            quick_replies: t.Optional(t.Boolean()),
            url_buttons: t.Optional(t.Boolean()),
            lists: t.Optional(t.Boolean()),
            max_quick_replies: t.Optional(t.Nullable(t.Number()))
          })
        )
      })
    }
  );
}
