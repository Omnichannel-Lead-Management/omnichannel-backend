const NODE_ENV = process.env.NODE_ENV || "development";

const DEFAULT_DEV_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];

function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;

  const integer = Math.trunc(parsed);
  if (integer < min || integer > max) return fallback;

  return integer;
}

const configuredCorsOrigins = unique(
  parseOriginList(process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_ORIGIN)
);

const fallbackCorsOrigins =
  NODE_ENV === "development" ? DEFAULT_DEV_ALLOWED_ORIGINS : [];

const allowedCorsOrigins = unique(
  configuredCorsOrigins.length > 0 ? configuredCorsOrigins : fallbackCorsOrigins
);

const allowedOriginSet = new Set(allowedCorsOrigins);

export function getAllowedCorsOrigins(): string[] {
  return allowedCorsOrigins;
}

export function describeAllowedCorsOrigins(): string {
  if (allowedCorsOrigins.length === 0) return "(none configured)";
  return allowedCorsOrigins.join(", ");
}

export function isOriginAllowed(origin: string | null | undefined): boolean {
  // Non-browser clients (curl, internal services) typically have no Origin header.
  if (!origin) return true;
  return allowedOriginSet.has(origin);
}

export const wsChatRateLimitConfig = {
  maxMessages: parsePositiveInt(
    process.env.WS_CHAT_RATE_LIMIT_MAX_MESSAGES,
    30,
    1,
    10_000
  ),
  windowMs: parsePositiveInt(
    process.env.WS_CHAT_RATE_LIMIT_WINDOW_MS,
    10_000,
    250,
    600_000
  )
};

export const wsAgentRateLimitConfig = {
  maxMessages: parsePositiveInt(
    process.env.WS_AGENT_RATE_LIMIT_MAX_MESSAGES,
    120,
    1,
    50_000
  ),
  windowMs: parsePositiveInt(
    process.env.WS_AGENT_RATE_LIMIT_WINDOW_MS,
    10_000,
    250,
    600_000
  )
};
