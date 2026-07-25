import { describe, expect, test } from "bun:test";
import {
  getAgentHealth,
  getAgentsHealth,
  isCircuitOpen,
  recordAgentFailure,
  recordAgentSuccess
} from "./circuitBreaker";

describe("circuitBreaker unit", () => {
  test("opens after 3 failures and recovers on success", () => {
    const agent = `agent_${crypto.randomUUID()}`;
    const t0 = Date.now();

    expect(isCircuitOpen(agent, t0)).toBe(false);
    expect(getAgentHealth(agent, t0)).toBe("up");

    expect(recordAgentFailure(agent, t0).circuitOpened).toBe(false);
    expect(recordAgentFailure(agent, t0 + 1).circuitOpened).toBe(false);
    const opened = recordAgentFailure(agent, t0 + 2);
    expect(opened.circuitOpened).toBe(true);
    expect(isCircuitOpen(agent, t0 + 3)).toBe(true);
    expect(getAgentHealth(agent, t0 + 3)).toBe("circuit-open");

    recordAgentSuccess(agent);
    expect(isCircuitOpen(agent, t0 + 4)).toBe(false);
    expect(getAgentHealth(agent, t0 + 4)).toBe("up");
  });

  test("getAgentsHealth maps each agent", () => {
    const a = `a_${crypto.randomUUID()}`;
    const b = `b_${crypto.randomUUID()}`;
    recordAgentFailure(a);
    const health = getAgentsHealth([a, b]);
    expect(health[a]).toBe("down");
    expect(health[b]).toBe("up");
  });
});
