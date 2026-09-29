/**
 * Gateway authorization gate.
 *
 * Every `/api/` route requires a dashboard session token except the small
 * allowlist below. Two things that are NOT dashboard callers also get through:
 *
 *  - Platform webhooks (`/webhook/*`) — Telegram/WhatsApp/Evolution call these
 *    from the outside and carry their own per-tenant secrets.
 *  - Sibling services (chatbot, lead-manager, appointment) — they read
 *    `/api/businesses/:id` over the Docker network with no user session, so
 *    they present INTERNAL_SERVICE_TOKEN instead. Without this the confirmation
 *    -email recipient lookup breaks the moment auth is switched on.
 *
 * `/api/admin/` is the platform console and is gated separately, on an admin
 * session. The separation runs both ways and is the whole security property of
 * the admin side:
 *
 *  - a business-owner token is refused on every admin route, so a tenant
 *    cannot read the platform's books or other tenants' volumes;
 *  - an admin token is refused on every non-admin route, so platform staff
 *    cannot reach `/api/businesses/:id/conversations` or any other endpoint
 *    that would show them a customer's messages.
 */

import { adminAuthService, type AdminAuthService, type AdminIdentity } from "../services/AdminAuth";
import {
  sessionAuthService,
  timingSafeEqual,
  type SessionAuthService,
  type SessionIdentity
} from "../services/SessionAuth";

/** Paths served without any credential. Matched against the pathname only. */
const PUBLIC_EXACT = new Set([
  "/api/auth/login",
  "/api/messaging/health",
  "/api/messaging/receive",
  // Self-service tenant registration: a brand new owner has no session yet.
  "/api/businesses"
]);

const PUBLIC_PREFIXES = ["/webhook/", "/ws/", "/swagger", "/api/health"];

/** Routes served to platform admins, on an admin session and nothing else. */
const ADMIN_PREFIX = "/api/admin/";

/** Only `/api/` is gated; the gateway serves nothing else that needs a session. */
const GUARDED_PREFIX = "/api/";

export interface AuthDecision {
  allow: boolean;
  status?: number;
  error?: string;
  identity?: SessionIdentity;
  admin?: AdminIdentity;
  /** True when the caller authenticated as a sibling service, not a user. */
  internal?: boolean;
}

/**
 * Bodies are read here so tenant scoping cannot be bypassed by moving the id
 * out of the URL. Only small JSON payloads are inspected — uploads are
 * multipart and are skipped by the content-type check.
 */
const MAX_INSPECTED_BODY_BYTES = 64 * 1024;

const BUSINESS_PATH = /^\/api\/businesses\/([^/]+)/;

/**
 * Every business id this request claims to act on, from the path, the query
 * string and a JSON body. A request that names no business is not scoped by
 * one (e.g. `/api/agents/status`) and is left to the route.
 */
async function claimedBusinessIds(request: Request, url: URL): Promise<string[]> {
  const claims: string[] = [];

  const fromPath = BUSINESS_PATH.exec(url.pathname);
  if (fromPath?.[1]) claims.push(decodeURIComponent(fromPath[1]));

  for (const key of ["businessId", "business_id"]) {
    const value = url.searchParams.get(key)?.trim();
    if (value) claims.push(value);
  }

  const contentType = request.headers.get("content-type") ?? "";
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  const inspectable =
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    contentType.includes("application/json") &&
    declaredLength <= MAX_INSPECTED_BODY_BYTES;

  if (inspectable) {
    try {
      // clone() leaves the original stream intact for Elysia to parse.
      const body: unknown = await request.clone().json();
      if (body && typeof body === "object" && !Array.isArray(body)) {
        for (const key of ["business_id", "businessId"]) {
          const value = (body as Record<string, unknown>)[key];
          if (typeof value === "string" && value.trim()) claims.push(value.trim());
        }
      }
    } catch {
      // Unparseable body: the route's own validation will reject it.
    }
  }

  return claims;
}

export function isAdminPath(pathname: string): boolean {
  return pathname.startsWith(ADMIN_PREFIX);
}

export function isPublicPath(pathname: string, method: string): boolean {
  // CORS preflight carries no Authorization header by design.
  if (method === "OPTIONS") return true;
  if (!pathname.startsWith(GUARDED_PREFIX)) return true;

  // `POST /api/businesses` is signup; `GET /api/businesses/:id` is not.
  if (pathname === "/api/businesses") return method === "POST";
  if (PUBLIC_EXACT.has(pathname)) return true;

  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function bearerToken(headers: Headers): string {
  const raw = headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1]!.trim() : "";
}

/**
 * EventSource cannot set headers, so the lead stream passes its session token
 * as a query parameter. Accepted only for that one SSE route.
 */
const QUERY_TOKEN_PATHS = new Set(["/api/leads/stream"]);

/**
 * `auth` is injectable because the module-level singleton reads AUTH_JWT_SECRET
 * once at import; tests need to supply a service built on a known secret.
 */
export async function authorize(
  request: Request,
  auth: SessionAuthService = sessionAuthService,
  admin: AdminAuthService = adminAuthService
): Promise<AuthDecision> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (isPublicPath(pathname, request.method)) return { allow: true };

  if (isAdminPath(pathname)) return await authorizeAdmin(request, pathname, admin);

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "";
  const presented = request.headers.get("x-internal-token")?.trim() ?? "";
  if (internalToken && presented && timingSafeEqual(presented, internalToken)) {
    return { allow: true, internal: true };
  }

  if (!auth.configured) {
    // Fail closed: an unconfigured secret must never mean "let everyone in".
    return {
      allow: false,
      status: 503,
      error: "Authentication is not configured on this server"
    };
  }

  let token = bearerToken(request.headers);
  if (!token && QUERY_TOKEN_PATHS.has(pathname)) {
    token = url.searchParams.get("access_token")?.trim() ?? "";
  }

  if (!token) {
    return { allow: false, status: 401, error: "Authentication required" };
  }

  const identity = await auth.verify(token);
  if (!identity) {
    // A valid admin token here is not an expired session, it is the wrong kind
    // of session, and saying so stops the console from silently signing the
    // admin out when a shared component calls a tenant endpoint.
    if (await admin.verify(token)) {
      return {
        allow: false,
        status: 403,
        error: "Admin sessions cannot access business data"
      };
    }
    return { allow: false, status: 401, error: "Session is invalid or has expired" };
  }

  // Authentication is not authorization: a valid session for tenant A must not
  // reach tenant B's data by putting B's id in the path, query or body.
  const claims = await claimedBusinessIds(request, url);
  if (claims.some((claimed) => claimed !== identity.business_id)) {
    return {
      allow: false,
      status: 403,
      error: "This session cannot access that business",
      identity
    };
  }

  return { allow: true, identity };
}

/**
 * `/api/admin/` is a closed world: only an admin session opens it. Neither the
 * internal service token nor a tenant session is accepted, because neither has
 * any business reading the platform's billing data.
 */
async function authorizeAdmin(
  request: Request,
  pathname: string,
  admin: AdminAuthService
): Promise<AuthDecision> {
  // Signing in is how you get a token, so it cannot itself require one.
  if (pathname === "/api/admin/auth/login") return { allow: true };

  if (!admin.configured) {
    // Fail closed, exactly as the tenant gate does with AUTH_JWT_SECRET.
    return {
      allow: false,
      status: 503,
      error: "Admin authentication is not configured on this server"
    };
  }

  const token = bearerToken(request.headers);
  if (!token) {
    return { allow: false, status: 401, error: "Admin authentication required" };
  }

  const identity = await admin.verify(token);
  if (!identity) {
    return {
      allow: false,
      status: 401,
      error: "Admin session is invalid or has expired"
    };
  }

  return { allow: true, admin: identity };
}
