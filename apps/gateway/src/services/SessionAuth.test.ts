import { describe, expect, test } from "bun:test";
import { SessionAuthService, timingSafeEqual } from "./SessionAuth";

const SECRET = "test-secret-value-long-enough";

function service(env: Record<string, string | undefined> = {}) {
  return new SessionAuthService({ AUTH_JWT_SECRET: SECRET, ...env });
}

describe("SessionAuthService passwords", () => {
  test("verifies a password against its own hash", async () => {
    const auth = service();
    const hash = await auth.hashPassword("correct horse battery");

    expect(await auth.verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await auth.verifyPassword("wrong password", hash)).toBe(false);
  });

  test("a business with no password can never be signed into", async () => {
    const auth = service();

    expect(await auth.verifyPassword("anything", null)).toBe(false);
    expect(await auth.verifyPassword("anything", undefined)).toBe(false);
    expect(await auth.verifyPassword("anything", "")).toBe(false);
  });

  test("a malformed stored hash fails closed instead of throwing", async () => {
    const auth = service();
    expect(await auth.verifyPassword("anything", "not-a-hash")).toBe(false);
  });

  test("hashes are salted, so equal passwords do not collide", async () => {
    const auth = service();
    const first = await auth.hashPassword("same password");
    const second = await auth.hashPassword("same password");

    expect(first).not.toBe(second);
    expect(await auth.verifyPassword("same password", first)).toBe(true);
    expect(await auth.verifyPassword("same password", second)).toBe(true);
  });
});

describe("SessionAuthService tokens", () => {
  test("issues a token that verifies back to the same identity", async () => {
    const auth = service();
    const { token, expires_at } = await auth.issue({
      business_id: "biz_1",
      email: "owner@example.test"
    });

    const identity = await auth.verify(token);
    expect(identity).toEqual({ business_id: "biz_1", email: "owner@example.test" });
    expect(Date.parse(expires_at)).toBeGreaterThan(Date.now());
  });

  test("rejects a token signed with a different secret", async () => {
    const issuer = service();
    const verifier = new SessionAuthService({ AUTH_JWT_SECRET: "a-different-secret" });

    const { token } = await issuer.issue({ business_id: "biz_1", email: "a@b.test" });
    expect(await verifier.verify(token)).toBeNull();
  });

  test("rejects a tampered payload", async () => {
    const auth = service();
    const { token } = await auth.issue({ business_id: "biz_1", email: "a@b.test" });

    const [header, , signature] = token.split(".");
    const forged = btoa(JSON.stringify({ sub: "biz_victim", exp: 9999999999, iss: "omnichannel-gateway" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await auth.verify(`${header}.${forged}.${signature}`)).toBeNull();
  });

  test("rejects the alg=none downgrade", async () => {
    const auth = service();
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const unsigned = `${encode({ alg: "none", typ: "JWT" })}.${encode({
      sub: "biz_1",
      exp: 9999999999,
      iss: "omnichannel-gateway"
    })}.`;

    expect(await auth.verify(unsigned)).toBeNull();
  });

  test("rejects an expired token", async () => {
    // Negative TTL is coerced to the default, so expire via a zero-length window.
    const auth = new SessionAuthService({
      AUTH_JWT_SECRET: SECRET,
      AUTH_SESSION_TTL_HOURS: "0.0001"
    });
    const { token } = await auth.issue({ business_id: "biz_1", email: "a@b.test" });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await auth.verify(token)).toBeNull();
  });

  test("rejects malformed input without throwing", async () => {
    const auth = service();

    expect(await auth.verify("")).toBeNull();
    expect(await auth.verify("not-a-jwt")).toBeNull();
    expect(await auth.verify("a.b")).toBeNull();
    expect(await auth.verify("!!!.???.###")).toBeNull();
  });

  test("an unconfigured secret verifies nothing and issues nothing", async () => {
    const auth = new SessionAuthService({});

    expect(auth.configured).toBe(false);
    expect(await auth.verify("anything")).toBeNull();
    await expect(auth.issue({ business_id: "biz_1", email: "a@b.test" })).rejects.toThrow();
  });
});

describe("timingSafeEqual", () => {
  test("matches equal strings and rejects everything else", () => {
    expect(timingSafeEqual("token", "token")).toBe(true);
    expect(timingSafeEqual("token", "token-longer")).toBe(false);
    expect(timingSafeEqual("token", "toker")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
