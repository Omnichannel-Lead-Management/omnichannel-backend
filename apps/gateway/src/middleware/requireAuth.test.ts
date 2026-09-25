import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { authorize, isPublicPath } from "./requireAuth";
import { SessionAuthService } from "../services/SessionAuth";

const SECRET = "test-secret-value-long-enough";
const auth = new SessionAuthService({ AUTH_JWT_SECRET: SECRET });
const original = {
  INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN
};

beforeEach(() => {
  process.env.INTERNAL_SERVICE_TOKEN = "internal-token";
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function get(path: string, init: RequestInit = {}) {
  return new Request(`http://gateway.test${path}`, init);
}

async function validToken(businessId = "biz_1") {
  const { token } = await auth.issue({ business_id: businessId, email: "owner@example.test" });
  return token;
}

describe("isPublicPath", () => {
  test("lets unauthenticated callers reach login, health and inbound messages", () => {
    expect(isPublicPath("/api/auth/login", "POST")).toBe(true);
    expect(isPublicPath("/api/health", "GET")).toBe(true);
    expect(isPublicPath("/api/health/all", "GET")).toBe(true);
    expect(isPublicPath("/api/messaging/health", "GET")).toBe(true);
    expect(isPublicPath("/api/messaging/receive", "POST")).toBe(true);
  });

  test("keeps platform webhooks and websockets open", () => {
    expect(isPublicPath("/webhook/telegram", "POST")).toBe(true);
    expect(isPublicPath("/webhook/evolution/biz_1", "POST")).toBe(true);
    expect(isPublicPath("/ws/chat", "GET")).toBe(true);
    expect(isPublicPath("/ws/agents", "GET")).toBe(true);
  });

  test("registration is public but reading a business is not", () => {
    expect(isPublicPath("/api/businesses", "POST")).toBe(true);
    expect(isPublicPath("/api/businesses", "GET")).toBe(false);
    expect(isPublicPath("/api/businesses/biz_1", "GET")).toBe(false);
  });

  test("dashboard data routes are guarded", () => {
    expect(isPublicPath("/api/leads", "GET")).toBe(false);
    expect(isPublicPath("/api/appointments", "GET")).toBe(false);
    expect(isPublicPath("/api/messaging/reply", "POST")).toBe(false);
    expect(isPublicPath("/api/messaging/history", "GET")).toBe(false);
    expect(isPublicPath("/api/businesses/biz_1/notifications", "GET")).toBe(false);
  });

  test("CORS preflight is never challenged", () => {
    expect(isPublicPath("/api/leads", "OPTIONS")).toBe(true);
  });
});

describe("authorize", () => {
  test("allows a public route with no credential", async () => {
    const decision = await authorize(get("/api/auth/login", { method: "POST" }), auth);
    expect(decision.allow).toBe(true);
  });

  test("rejects a guarded route with no credential", async () => {
    const decision = await authorize(get("/api/leads"), auth);
    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("accepts a valid session token", async () => {
    const decision = await authorize(
      get("/api/leads", { headers: { authorization: `Bearer ${await validToken()}` } }),
      auth
    );

    expect(decision.allow).toBe(true);
    expect(decision.identity?.business_id).toBe("biz_1");
  });

  test("rejects a garbage bearer token", async () => {
    const decision = await authorize(
      get("/api/leads", { headers: { authorization: "Bearer not-a-real-token" } }),
      auth
    );

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("rejects a token signed with another secret", async () => {
    const foreign = new SessionAuthService({ AUTH_JWT_SECRET: "some-other-secret" });
    const { token } = await foreign.issue({ business_id: "biz_1", email: "a@b.test" });

    const decision = await authorize(
      get("/api/leads", { headers: { authorization: `Bearer ${token}` } }),
      auth
    );

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("accepts the internal service token from sibling services", async () => {
    const decision = await authorize(
      get("/api/businesses/biz_1", { headers: { "x-internal-token": "internal-token" } }),
      auth
    );

    expect(decision.allow).toBe(true);
    expect(decision.internal).toBe(true);
  });

  test("rejects a wrong internal service token", async () => {
    const decision = await authorize(
      get("/api/businesses/biz_1", { headers: { "x-internal-token": "guessed" } }),
      auth
    );

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("an unset internal token does not let a blank header through", async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;

    const decision = await authorize(
      get("/api/businesses/biz_1", { headers: { "x-internal-token": "" } }),
      auth
    );

    expect(decision.allow).toBe(false);
  });

  test("an unconfigured server refuses rather than falling open", async () => {
    const unconfigured = new SessionAuthService({});
    const decision = await authorize(get("/api/leads"), unconfigured);

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(503);
  });

  test("the lead stream accepts its token as a query parameter", async () => {
    const token = await validToken();
    const decision = await authorize(
      get(`/api/leads/stream?businessId=biz_1&access_token=${encodeURIComponent(token)}`),
      auth
    );

    expect(decision.allow).toBe(true);
  });

  test("other routes do not accept a query-parameter token", async () => {
    const token = await validToken();
    const decision = await authorize(
      get(`/api/leads?access_token=${encodeURIComponent(token)}`),
      auth
    );

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
  });
});

describe("cross-tenant authorization", () => {
  test("a session reaches its own business by path", async () => {
    const decision = await authorize(
      get("/api/businesses/biz_1/notifications", {
        headers: { authorization: `Bearer ${await validToken("biz_1")}` }
      }),
      auth
    );

    expect(decision.allow).toBe(true);
  });

  test("a session cannot reach another business by path", async () => {
    const decision = await authorize(
      get("/api/businesses/biz_victim/notifications", {
        headers: { authorization: `Bearer ${await validToken("biz_1")}` }
      }),
      auth
    );

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(403);
  });

  test("a session cannot reach another business by query string", async () => {
    const decision = await authorize(
      get("/api/leads?businessId=biz_victim", {
        headers: { authorization: `Bearer ${await validToken("biz_1")}` }
      }),
      auth
    );

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(403);
  });

  test("a session cannot reach another business through the request body", async () => {
    // lead-manager scopes PATCH /api/leads/:id off body.business_id, so a body
    // the gateway forwards unchecked would be a cross-tenant write.
    const body = JSON.stringify({ business_id: "biz_victim", status: "won" });
    const decision = await authorize(
      get("/api/leads/lead_1", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${await validToken("biz_1")}`,
          "content-type": "application/json",
          "content-length": String(body.length)
        },
        body
      }),
      auth
    );

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(403);
  });

  test("its own id in the body is allowed", async () => {
    const body = JSON.stringify({ business_id: "biz_1", status: "won" });
    const decision = await authorize(
      get("/api/leads/lead_1", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${await validToken("biz_1")}`,
          "content-type": "application/json",
          "content-length": String(body.length)
        },
        body
      }),
      auth
    );

    expect(decision.allow).toBe(true);
  });

  test("reading the body for scoping leaves it intact for the route", async () => {
    const body = JSON.stringify({ business_id: "biz_1", status: "won" });
    const request = get("/api/leads/lead_1", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${await validToken("biz_1")}`,
        "content-type": "application/json",
        "content-length": String(body.length)
      },
      body
    });

    await authorize(request, auth);
    expect(await request.json()).toEqual({ business_id: "biz_1", status: "won" });
  });

  test("a request naming no business is left to the route", async () => {
    const decision = await authorize(
      get("/api/agents/status", {
        headers: { authorization: `Bearer ${await validToken("biz_1")}` }
      }),
      auth
    );

    expect(decision.allow).toBe(true);
  });

  test("sibling services stay exempt, because they act across tenants", async () => {
    const decision = await authorize(
      get("/api/businesses/any_tenant", {
        headers: { "x-internal-token": "internal-token" }
      }),
      auth
    );

    expect(decision.allow).toBe(true);
    expect(decision.internal).toBe(true);
  });
});
