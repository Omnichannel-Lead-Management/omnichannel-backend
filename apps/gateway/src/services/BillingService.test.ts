/**
 * The pricing calculation, tested directly. It is pure, so these tests need no
 * database — which is the point of having split it out: the arithmetic that
 * decides what a customer owes should be checkable in isolation.
 */

import { describe, expect, test } from "bun:test";
import { priceUsage, type PricingPlanRow } from "./BillingService";
import type { UsageSummary } from "./UsageMeter";

const PERIOD = { from: "2026-09-01", to: "2026-09-30" };

function plan(overrides: Partial<PricingPlanRow> = {}): PricingPlanRow {
  return {
    id: "plan_test",
    name: "Standard",
    description: null,
    currency: "LKR",
    monthly_fee: 2500,
    included_ai_requests: 500,
    price_per_ai_request: 4,
    included_conversations: 100,
    price_per_conversation: 25,
    included_messages: 2000,
    price_per_message: 0.5,
    tax_percent: 0,
    is_default: 1,
    archived: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function usage(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    period: PERIOD,
    ai_requests: 0,
    ai_by_kind: { ai_reply: 0, ai_voice: 0, ai_vision: 0, ai_other: 0 },
    conversations: 0,
    messages: 0,
    inbound_messages: 0,
    outbound_messages: 0,
    new_contacts: 0,
    total_contacts: 0,
    ...overrides
  };
}

describe("allowances", () => {
  test("a tenant inside every allowance pays only the subscription", () => {
    const draft = priceUsage(
      plan(),
      usage({ ai_requests: 400, conversations: 60, messages: 1500 }),
      PERIOD
    );

    expect(draft.line_items).toHaveLength(1);
    expect(draft.line_items[0]!.kind).toBe("subscription");
    expect(draft.total).toBe(2500);
  });

  test("only usage above the allowance is charged", () => {
    const draft = priceUsage(plan(), usage({ ai_requests: 750 }), PERIOD);

    const ai = draft.line_items.find((line) => line.kind === "ai_requests");
    expect(ai?.quantity).toBe(250);
    expect(ai?.amount).toBe(1000);
    expect(draft.total).toBe(3500);
  });

  test("the AI line names both the usage and the allowance", () => {
    const draft = priceUsage(plan(), usage({ ai_requests: 750 }), PERIOD);
    const ai = draft.line_items.find((line) => line.kind === "ai_requests");

    expect(ai?.description).toBe("AI requests — 750 used, 500 included");
  });

  test("a zero-priced dimension never appears, however much is used", () => {
    const draft = priceUsage(
      plan({ price_per_message: 0, included_messages: 0 }),
      usage({ messages: 50_000 }),
      PERIOD
    );

    expect(draft.line_items.some((line) => line.kind === "messages")).toBe(false);
  });

  test("a plan with no subscription fee bills usage alone", () => {
    const draft = priceUsage(
      plan({ monthly_fee: 0 }),
      usage({ ai_requests: 600 }),
      PERIOD
    );

    expect(draft.line_items.map((line) => line.kind)).toEqual(["ai_requests"]);
    expect(draft.total).toBe(400);
  });
});

describe("AI is the expensive line", () => {
  test("the same volume costs far more as AI than as plain messages", () => {
    const asAi = priceUsage(
      plan({ monthly_fee: 0, included_ai_requests: 0 }),
      usage({ ai_requests: 1000 }),
      PERIOD
    );
    const asMessages = priceUsage(
      plan({ monthly_fee: 0, included_messages: 0 }),
      usage({ messages: 1000 }),
      PERIOD
    );

    expect(asAi.total).toBe(4000);
    expect(asMessages.total).toBe(500);
    expect(asAi.total).toBeGreaterThan(asMessages.total);
  });

  test("raising the AI price raises the bill proportionally", () => {
    const cheap = priceUsage(plan({ price_per_ai_request: 4 }), usage({ ai_requests: 1500 }), PERIOD);
    const dear = priceUsage(plan({ price_per_ai_request: 8 }), usage({ ai_requests: 1500 }), PERIOD);

    expect(dear.total - 2500).toBe((cheap.total - 2500) * 2);
  });
});

describe("money", () => {
  test("fractional unit prices do not accumulate float error", () => {
    // 0.1 × 3 is the textbook float trap; the total must still be exact.
    const draft = priceUsage(
      plan({ monthly_fee: 0, included_messages: 0, price_per_message: 0.1 }),
      usage({ messages: 3 }),
      PERIOD
    );

    expect(draft.total).toBe(0.3);
  });

  test("tax is applied to the subtotal and rounded once", () => {
    const draft = priceUsage(
      plan({ tax_percent: 15 }),
      usage({ ai_requests: 750 }),
      PERIOD
    );

    expect(draft.subtotal).toBe(3500);
    expect(draft.tax).toBe(525);
    expect(draft.total).toBe(4025);
  });

  test("an awkward tax rate rounds to whole cents", () => {
    const draft = priceUsage(
      plan({ monthly_fee: 33.33, tax_percent: 7.5 }),
      usage(),
      PERIOD
    );

    expect(draft.tax).toBe(2.5);
    expect(draft.total).toBe(35.83);
  });

  test("the draft carries the plan's currency, not a global one", () => {
    const draft = priceUsage(plan({ currency: "USD" }), usage(), PERIOD);
    expect(draft.currency).toBe("USD");
  });
});

describe("manual adjustments", () => {
  test("an extra line is priced and included in the total", () => {
    const draft = priceUsage(plan({ monthly_fee: 1000 }), usage(), PERIOD, [
      {
        kind: "adjustment",
        description: "Onboarding support",
        quantity: 2,
        unit_price: 150,
        amount: 0
      }
    ]);

    expect(draft.line_items.at(-1)?.amount).toBe(300);
    expect(draft.total).toBe(1300);
  });
});

describe("the usage snapshot", () => {
  test("travels with the draft so the bill can be reconciled later", () => {
    const counts = usage({ ai_requests: 750, conversations: 120, messages: 3000 });
    const draft = priceUsage(plan(), counts, PERIOD);

    expect(draft.usage).toEqual(counts);
    expect(draft.plan.id).toBe("plan_test");
  });
});
