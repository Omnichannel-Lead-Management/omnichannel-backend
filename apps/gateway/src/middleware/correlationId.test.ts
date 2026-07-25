import { describe, expect, test } from "bun:test";
import {
  CORRELATION_ID_HEADER,
  extractRequestId,
  formatCorrelationLog,
  generateCorrelationId
} from "./correlationId";

describe("correlationId unit", () => {
  test("generateCorrelationId returns uuid-like string", () => {
    const id = generateCorrelationId();
    expect(id.length).toBeGreaterThan(10);
    expect(id).toContain("-");
  });

  test("formatCorrelationLog includes request id and event", () => {
    const line = formatCorrelationLog("abc-123", "WEBHOOK_RECEIVED", "platform=telegram");
    expect(line).toContain("[REQ-abc-123]");
    expect(line).toContain("WEBHOOK_RECEIVED");
    expect(line).toContain("platform=telegram");
  });

  test("extractRequestId trims valid ids and rejects empty", () => {
    expect(extractRequestId({ request_id: "  req_1  " })).toBe("req_1");
    expect(extractRequestId({ request_id: "   " })).toBeUndefined();
    expect(extractRequestId({})).toBeUndefined();
  });

  test("header constant is stable", () => {
    expect(CORRELATION_ID_HEADER).toBe("X-Request-ID");
  });
});
