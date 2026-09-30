import { describe, expect, test } from "bun:test";
import {
  getAgent,
  getDownstreamAgentNames,
  getRegisteredAgents
} from "./registry";
import type { ChatRequest } from "../types";

const baseReq: ChatRequest = {
  message: "How much for a haircut?",
  messenger_id: "user_1",
  platform: "telegram",
  language: "en",
  language_tag: "english"
};

describe("agent registry unit", () => {
  test("registers expected lead-platform agents", () => {
    const names = getRegisteredAgents().map((agent) => agent.name).sort();
    expect(names).toEqual(
      ["appointment_booking", "general", "lead_qualification", "service_inquiry"].sort()
    );
  });

  test("downstream agents exclude general (no URL)", () => {
    const downstream = getDownstreamAgentNames().sort();
    expect(downstream).toEqual(
      ["appointment_booking", "lead_qualification", "service_inquiry"].sort()
    );
    expect(getAgent("general")?.url).toBe("");
  });

  test("service_inquiry buildRequest forwards language tags", () => {
    const agent = getAgent("service_inquiry");
    expect(agent).toBeDefined();
    const body = agent!.buildRequest("pricing question", baseReq);
    expect(body.message).toBe("pricing question");
    expect(body.messenger_id).toBe("user_1");
    expect(body.language).toBe("en");
    expect(body.language_tag).toBe("english");
  });

  test("every downstream agent forwards the customer's platform", () => {
    for (const name of getDownstreamAgentNames()) {
      const body = getAgent(name)!.buildRequest("hello", baseReq);
      expect(body.platform).toBe("telegram");
    }
  });

  test("parseResponse marks escalated when downstream says so", () => {
    const agent = getAgent("lead_qualification");
    const parsed = agent!.parseResponse({
      success: true,
      messages: [{ type: "text", text: "Connecting you" }],
      escalated: true
    });
    expect(parsed.escalated).toBe(true);
    expect(parsed.messages[0]?.text).toContain("Connecting");
  });
});
