import { describe, expect, test } from "bun:test";
import { WebSocketRateLimiter } from "./WebSocketRateLimiter";

describe("WebSocketRateLimiter unit", () => {
  test("allows up to maxMessages then blocks", () => {
    const limiter = new WebSocketRateLimiter({
      keyPrefix: "test",
      maxMessages: 3,
      windowMs: 10_000
    });
    const socket = { remoteAddress: "1.2.3.4" };

    expect(limiter.consume(socket).allowed).toBe(true);
    expect(limiter.consume(socket).allowed).toBe(true);
    expect(limiter.consume(socket).allowed).toBe(true);
    const blocked = limiter.consume(socket);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  test("different IPs have independent windows", () => {
    const limiter = new WebSocketRateLimiter({
      keyPrefix: "test",
      maxMessages: 1,
      windowMs: 10_000
    });
    expect(limiter.consume({ remoteAddress: "10.0.0.1" }).allowed).toBe(true);
    expect(limiter.consume({ remoteAddress: "10.0.0.1" }).allowed).toBe(false);
    expect(limiter.consume({ remoteAddress: "10.0.0.2" }).allowed).toBe(true);
  });
});
