/**
 * The separation between the two session systems is the security property the
 * whole admin console rests on, so it is tested from the gate's point of view:
 * what a token opens, and — more importantly — what it does not.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { authorize, isAdminPath, isPublicPath } from "./requireAuth";
import { SessionAuthService } from "../services/SessionAuth";
import { AdminAuthService } from "../services/AdminAuth";

const TENANT_SECRET = "tenant-secret-value-long-enough";
const ADMIN_SECRET = "admin-secret-value-long-enough";

const tenantAuth = new SessionAuthService({ AUTH_JWT_SECRET: TENANT_SECRET });
const adminAuth = new AdminAuthService({ ADMIN_JWT_SECRET: ADMIN_SECRET });

const original = { INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN };

beforeEach(() => {
  process.env.INTERNAL_SERVICE_TOKEN = "internal-token";
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function get(path: string, token?: string, init: RequestInit = {}) {
  return new Request(`http://gateway.test${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {})
    }
  });
}

async function tenantToken(businessId = "biz_1") {
  const { token } = await tenantAuth.issue({ business_id: businessId, email: "owner@example.test" });
  return token;
}

async function adminToken(role: "owner" | "staff" = "owner") {
  const { token } = await adminAuth.issue({
    admin_id: "adm_1",
    email: "ops@platform.test",
    role
  });
  return token;
}

const decide = (request: Request) => authorize(request, tenantAuth, adminAuth);

describe("admin path detection", () => {
  test("only /api/admin/ is the console", () => {
    expect(isAdminPath("/api/admin/overview")).toBe(true);
    expect(isAdminPath("/api/admin/auth/login")).toBe(true);
    expect(isAdminPath("/api/businesses/biz_1/conversations")).toBe(false);
    // A tenant route that merely contains the word must not be mistaken for one.
    expect(isAdminPath("/api/businesses/admin/conversations")).toBe(false);
  });

  test("admin routes are not public", () => {
    expect(isPublicPath("/api/admin/overview", "GET")).toBe(false);
    expect(isPublicPath("/api/admin/invoices", "POST")).toBe(false);
  });
});

describe("admin sessions on admin routes", () => {
  test("signing in needs no token", async () => {
    const decision = await decide(get("/api/admin/auth/login", undefined, { method: "POST" }));
    expect(decision.allow).toBe(true);
  });

  test("a valid admin token is admitted and its identity is returned", async () => {
    const decision = await decide(get("/api/admin/overview", await adminToken("staff")));

    expect(decision.allow).toBe(true);
    expect(decision.admin).toEqual({
      admin_id: "adm_1",
      email: "ops@platform.test",
      role: "staff"
    });
  });

  test("no token is a 401", async () => {
    const decision = await decide(get("/api/admin/overview"));
    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("an unconfigured admin secret fails closed rather than open", async () => {
    const decision = await authorize(
      get("/api/admin/overview", await adminToken()),
      tenantAuth,
      new AdminAuthService({})
    );

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(503);
  });
});

describe("the two session systems cannot be crossed", () => {
  test("a business owner cannot reach the admin console", async () => {
    const decision = await decide(get("/api/admin/businesses", await tenantToken()));

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(401);
  });

  test("the internal service token does not open the admin console either", async () => {
    const decision = await decide(
      get("/api/admin/overview", undefined, {
        headers: { "x-internal-token": "internal-token" }
      })
    );

    expect(decision.allow).toBe(false);
  });

  test("an admin cannot read a tenant's conversations", async () => {
    const decision = await decide(
      get("/api/businesses/biz_1/conversations", await adminToken("owner"))
    );

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(403);
    expect(decision.error).toMatch(/cannot access business data/i);
  });

  test("an admin cannot read a tenant's message history or leads", async () => {
    const token = await adminToken();

    for (const path of [
      "/api/messaging/history?businessId=biz_1",
      "/api/leads",
      "/api/businesses/biz_1/notifications",
      "/api/businesses/biz_1/billing"
    ]) {
      const decision = await decide(get(path, token));
      expect(decision.allow).toBe(false);
    }
  });

  test("a tenant still reaches its own billing page", async () => {
    const decision = await decide(get("/api/businesses/biz_1/billing", await tenantToken("biz_1")));
    expect(decision.allow).toBe(true);
  });

  test("a tenant cannot read another tenant's billing page", async () => {
    const decision = await decide(get("/api/businesses/biz_2/billing", await tenantToken("biz_1")));

    expect(decision.allow).toBe(false);
    expect(decision.status).toBe(403);
  });
});

describe("admin token contents", () => {
  test("a token signed with the tenant secret is not an admin token", async () => {
    const forged = await tenantAuth.issue({ business_id: "adm_1", email: "ops@platform.test" });
    expect(await adminAuth.verify(forged.token)).toBeNull();
  });

  test("a token with an unknown role is rejected outright", async () => {
    const { token } = await adminAuth.issue({
      admin_id: "adm_1",
      email: "ops@platform.test",
      // Roles are a closed set; anything else means the token is not ours.
      role: "superuser" as unknown as "owner"
    });

    expect(await adminAuth.verify(token)).toBeNull();
  });
});
