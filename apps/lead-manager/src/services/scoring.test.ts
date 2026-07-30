import { describe, expect, test } from "bun:test";
import { scoreLead, signalsFromMessage } from "./scoring";

describe("scoreLead", () => {
  test("chatbot + premium + high budget stacks (65)", () => {
    const { score, reasons } = scoreLead({
      source: "chatbot",
      service_interest: "premium haircut package",
      budget_range: "high"
    });
    expect(score).toBe(65); // 30 + 20 + 15
    expect(reasons.length).toBe(3);
  });

  test("telegram source with premium keyword (30)", () => {
    const { score } = scoreLead({ source: "telegram", premium_interest: true });
    expect(score).toBe(30); // 10 + 20
  });

  test("empty signals score 0", () => {
    expect(scoreLead({}).score).toBe(0);
  });

  test("appointment booked adds 20", () => {
    expect(scoreLead({ appointment_booked: true }).score).toBe(20);
  });

  test("score is clamped to 100", () => {
    const { score } = scoreLead({
      source: "chatbot",
      premium_interest: true,
      budget_range: "high",
      appointment_booked: true
    });
    expect(score).toBeLessThanOrEqual(100);
  });

  test("escalation is surfaced as a reason flag, not points", () => {
    const { score, reasons } = scoreLead({ escalated: true });
    expect(score).toBe(0);
    expect(reasons.some((r) => r.includes("Escalated"))).toBe(true);
  });
});

describe("signalsFromMessage", () => {
  test("detects premium intent from free text", () => {
    expect(signalsFromMessage("Do you have a VIP deluxe option?").premium_interest).toBe(true);
    expect(signalsFromMessage("just a basic trim please").premium_interest).toBe(false);
  });
});
