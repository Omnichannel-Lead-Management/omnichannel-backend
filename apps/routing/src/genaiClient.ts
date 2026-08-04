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
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
export const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";

/**
 * Vertex serves generative models from a shared on-demand pool, and that pool
 * is exhausted *per model*: a 429 on one model says nothing about the others.
 * Measured on 2026-08-04, gemini-2.5-flash answered 0/3 requests while
 * flash-lite and pro both answered 3/3 in the same project, region and second.
 *
 * So the chain is a real availability mechanism, not a nicety — the configured
 * model first, then the others as independent capacity pools.
 */
const DEFAULT_FALLBACKS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"];

export const GEMINI_MODEL_CHAIN: string[] = [
  ...new Set([
    GEMINI_MODEL,
    ...(process.env.GEMINI_MODEL_FALLBACKS?.split(",").map((m) => m.trim()).filter(Boolean) ??
      DEFAULT_FALLBACKS)
  ])
];

/** Attempts per model before falling through to the next one. */
const ATTEMPTS_PER_MODEL = Math.max(1, Number(process.env.GEMINI_ATTEMPTS_PER_MODEL ?? 2));

/**
 * Transient = worth retrying. Capacity (429), upstream blips (500/503) and
 * deadline errors recover; 400/401/403/404 mean the request or the project is
 * wrong and will fail identically forever, so they short-circuit the whole
 * chain rather than burning a customer's latency budget on six doomed calls.
 */
export function isTransientGenAiError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  const code = (error as { code?: unknown } | null)?.code;
  const haystack = `${String(status ?? "")} ${String(code ?? "")} ${
    error instanceof Error ? error.message : String(error ?? "")
  }`.toUpperCase();

  if (/\b(400|401|403|404)\b|INVALID_ARGUMENT|UNAUTHENTICATED|PERMISSION_DENIED|NOT_FOUND/.test(haystack)) {
    return false;
  }
  return /\b(429|500|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|DEADLINE|ETIMEDOUT|ECONNRESET|FETCH FAILED/.test(
    haystack
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

type GenerateContentParams = Parameters<typeof ai.models.generateContent>[0];
type GenerateContentResult = Awaited<ReturnType<typeof ai.models.generateContent>>;

/**
 * generateContent with per-model retry, then fallback to the next model.
 *
 * Every customer message passes through this call, and before it existed a
 * single transient 429 ended the conversation with no reply at all.
 *
 * `client` and `wait` are injectable so the tests can drive the chain without
 * network access or real backoff delays.
 */
export async function generateContentWithFallback(
  params: Omit<GenerateContentParams, "model">,
  {
    models = GEMINI_MODEL_CHAIN,
    attemptsPerModel = ATTEMPTS_PER_MODEL,
    client = ai,
    wait = sleep,
    log = console.warn
  }: {
    models?: string[];
    attemptsPerModel?: number;
    client?: Pick<typeof ai, "models">;
    wait?: (ms: number) => Promise<unknown>;
    log?: (message: string) => void;
  } = {}
): Promise<GenerateContentResult> {
  let lastError: unknown;

  for (const [modelIndex, model] of models.entries()) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      try {
        const response = await client.models.generateContent({ ...params, model });
        if (modelIndex > 0 || attempt > 1) {
          log(`[router] genai recovered on model=${model} attempt=${attempt}`);
        }
        return response as GenerateContentResult;
      } catch (error) {
        lastError = error;
        if (!isTransientGenAiError(error)) throw error;

        const message = error instanceof Error ? error.message : String(error);
        log(`[router] genai transient failure model=${model} attempt=${attempt}: ${message.slice(0, 160)}`);

        // Back off between attempts on the same model; switching model is
        // itself the remedy, so don't also pay a delay on the way out.
        if (attempt < attemptsPerModel) await wait(250 * 2 ** (attempt - 1));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`All Gemini models failed: ${models.join(", ")}`);
}

console.log(
  GENAI_BACKEND === "vertex"
    ? `[router] Gemini via Vertex AI project=${process.env.GOOGLE_CLOUD_PROJECT} location=${VERTEX_LOCATION} model=${GEMINI_MODEL} fallbacks=${GEMINI_MODEL_CHAIN.slice(1).join(",") || "none"}`
    : `[router] Gemini via Developer API model=${GEMINI_MODEL} fallbacks=${GEMINI_MODEL_CHAIN.slice(1).join(",") || "none"}`
);
