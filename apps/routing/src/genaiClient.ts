import { GoogleGenAI } from "@google/genai";

/**
 * Gemini client used by the router.
 *
 * Preferred mode is Vertex AI: on a GCP VM (or anywhere with Application
 * Default Credentials) the attached service account authenticates the call, so
 * no API key ever lives in the environment. Set GOOGLE_CLOUD_PROJECT to enable
 * it — the SDK then talks to the Vertex endpoint for GOOGLE_CLOUD_LOCATION.
 *
 * The Gemini Developer API (GEMINI_API_KEY) remains as a fallback so the
 * service still runs on machines without gcloud credentials.
 */

export type GenAiBackend = "vertex" | "api-key";

function resolveBackend(): GenAiBackend {
  const explicit = process.env.GOOGLE_GENAI_USE_VERTEXAI;
  if (explicit !== undefined) {
    return explicit.toLowerCase() === "true" ? "vertex" : "api-key";
  }

  return process.env.GOOGLE_CLOUD_PROJECT ? "vertex" : "api-key";
}

export const GENAI_BACKEND: GenAiBackend = resolveBackend();
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
export const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

function createClient(): GoogleGenAI {
  if (GENAI_BACKEND === "vertex") {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      throw new Error(
        "GOOGLE_CLOUD_PROJECT environment variable is required when using Vertex AI"
      );
    }

    return new GoogleGenAI({
      vertexai: true,
      project,
      location: VERTEX_LOCATION
    });
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "Set GOOGLE_CLOUD_PROJECT to use Vertex AI, or GEMINI_API_KEY to use the Gemini Developer API"
    );
  }

  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

export const ai = createClient();

console.log(
  GENAI_BACKEND === "vertex"
    ? `[router] Gemini via Vertex AI project=${process.env.GOOGLE_CLOUD_PROJECT} location=${VERTEX_LOCATION} model=${GEMINI_MODEL}`
    : `[router] Gemini via Developer API model=${GEMINI_MODEL}`
);
