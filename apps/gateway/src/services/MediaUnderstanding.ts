import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
const TIMEOUT_MS = 20_000;

function resolveClient(): GoogleGenAI | null {
  const explicit = process.env.GOOGLE_GENAI_USE_VERTEXAI;
  const useVertex =
    explicit !== undefined ? explicit.toLowerCase() === "true" : Boolean(process.env.GOOGLE_CLOUD_PROJECT);

  try {
    if (useVertex) {
      const project = process.env.GOOGLE_CLOUD_PROJECT;
      if (!project) return null;
      return new GoogleGenAI({ vertexai: true, project, location: LOCATION });
    }
    if (!process.env.GEMINI_API_KEY) return null;
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  } catch {
    return null;
  }
}

let client: GoogleGenAI | null = null;
let initialized = false;

function getClient(): GoogleGenAI | null {
  if (initialized) return client;
  initialized = true;
  client = resolveClient();
  console.log(
    client
      ? `[media] Gemini ready via ${process.env.GOOGLE_CLOUD_PROJECT ? "Vertex AI" : "Developer API"} model=${MODEL}`
      : "[media] No Gemini credentials — voice notes and photos will not be understood"
  );
  return client;
}

export function mediaUnderstandingEnabled(): boolean {
  return getClient() !== null;
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

/** Gemini can hang; never let a webhook wait on it indefinitely. */
async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
    )
  ]);
}

/** Transcribe a voice note in the speaker's own language. */
export async function transcribeVoice(
  data: Uint8Array,
  mimeType: string
): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: mimeType || "audio/ogg", data: toBase64(data) } },
              {
                text:
                  "Transcribe this voice message exactly, in the language actually spoken " +
                  "(English, Sinhala or Tamil). Return ONLY the transcription, with no quotes, " +
                  "translation or commentary. If there is no intelligible speech, return an empty string."
              }
            ]
          }
        ],
        config: { temperature: 0 }
      })
    );

    const text = (response.text ?? "").trim();
    return text || null;
  } catch (err) {
    console.warn("[media] voice transcription failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface ImageUnderstanding {
  description: string;
  intent_hint: string;
}

/** Describe a photo a customer sent, in terms of what the business could act on. */
export async function describeCustomerImage(
  data: Uint8Array,
  mimeType: string,
  sector?: string
): Promise<ImageUnderstanding | null> {
  const ai = getClient();
  if (!ai) return null;

  const business = sector?.trim() ? `a ${sector.trim()} business` : "a local service business";

  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: mimeType || "image/jpeg", data: toBase64(data) } },
              {
                text:
                  `A customer of ${business} sent this photo, usually to ask whether the business ` +
                  "offers what is shown, or to show a problem or a reference they like. " +
                  'Respond as compact JSON: {"description":"<one short factual sentence naming what is ' +
                  'visible — style, product, condition or document>","intent_hint":"<what the customer ' +
                  'most likely wants, in a few words>"}. ' +
                  "Describe only what you can actually see. Do not guess prices or make promises."
              }
            ]
          }
        ],
        config: { temperature: 0, responseMimeType: "application/json" }
      })
    );

    const raw = (response.text ?? "").trim();
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ImageUnderstanding>;
    const description = parsed.description?.trim();
    if (!description) return null;

    return {
      description,
      intent_hint: parsed.intent_hint?.trim() || description
    };
  } catch (err) {
    console.warn("[media] image understanding failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Compose the message text the pipeline sees for a photo. */
export function photoMessageText(
  understanding: ImageUnderstanding | null,
  caption?: string
): string {
  const asked = caption?.trim();

  if (!understanding) {
    return asked
      ? `[The customer sent a photo that could not be viewed] They ask: "${asked}"`
      : "[The customer sent a photo that could not be viewed and said nothing else]";
  }

  const described = understanding.description.replace(/[.\s]+$/, "");
  const base = `[Photo] The customer sent a photo showing: ${described}.`;
  return asked
    ? `${base} They ask: "${asked}"`
    : `${base} They likely want: ${understanding.intent_hint}.`;
}

/** Compose the message text for a voice note, keeping any caption alongside it. */
export function voiceMessageText(transcript: string | null, caption?: string): string {
  const asked = caption?.trim();

  if (!transcript) {
    return asked
      ? `[Voice note that could not be transcribed] They also wrote: "${asked}"`
      : "[The customer sent a voice note that could not be transcribed]";
  }

  return asked ? `${transcript} (${asked})` : transcript;
}
