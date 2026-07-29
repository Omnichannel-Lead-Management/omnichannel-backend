import { GoogleGenAI } from "@google/genai";

/**
 * Gemini client used to pull booking details out of a customer's message.
 *
 * Mirrors the routing service's client: Vertex AI with Application Default
 * Credentials when GOOGLE_CLOUD_PROJECT is set, falling back to the Gemini
 * Developer API key otherwise. Unlike routing, the client is optional — when
 * nothing is configured the booking flow degrades to asking the customer for a
 * date and time in plain words rather than failing the request.
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

function useVertex(): boolean {
  const explicit = process.env.GOOGLE_GENAI_USE_VERTEXAI;
  if (explicit !== undefined) return explicit.toLowerCase() === "true";
  return Boolean(process.env.GOOGLE_CLOUD_PROJECT);
}

let client: GoogleGenAI | null = null;
let initialized = false;

export function getGenAiClient(): GoogleGenAI | null {
  if (initialized) return client;
  initialized = true;

  try {
    if (useVertex()) {
      const project = process.env.GOOGLE_CLOUD_PROJECT;
      if (!project) return (client = null);

      client = new GoogleGenAI({
        vertexai: true,
        project,
        location: VERTEX_LOCATION
      });
      console.log(
        `[appointment] Gemini via Vertex AI project=${project} location=${VERTEX_LOCATION} model=${GEMINI_MODEL}`
      );
      return client;
    }

    if (!process.env.GEMINI_API_KEY) {
      console.warn(
        "[appointment] No Gemini credentials — booking will ask for date/time instead of extracting them"
      );
      return (client = null);
    }

    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log(`[appointment] Gemini via Developer API model=${GEMINI_MODEL}`);
    return client;
  } catch (error) {
    console.warn(
      "[appointment] Gemini client unavailable:",
      error instanceof Error ? error.message : error
    );
    return (client = null);
  }
}

export { GEMINI_MODEL };
