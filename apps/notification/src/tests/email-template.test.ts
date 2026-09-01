import { describe, expect, test } from "bun:test";
import {
  renderEmailTemplate,
  type EmailTemplateInput
} from "../email/templates";

describe("email templates", () => {
  test("renders the new-lead subject, text, and HTML", () => {
    const rendered = renderEmailTemplate({
      template: "new_lead",
      data: {
        lead_id: "lead_123",
        business_name: "Pathirana Salon",
        service_interest: "Bridal package",
        platform: "telegram",
        score: 82
      }
    });

    expect(rendered.subject).toBe("New lead received");
    expect(rendered.text).toContain("A new lead was received.");
    expect(rendered.text).toContain("Lead ID: lead_123");
    expect(rendered.text).toContain("Service interest: Bridal package");
    expect(rendered.text).toContain("Platform: telegram");
    expect(rendered.text).toContain("Score: 82");
    expect(rendered.html).toContain("<p>A new lead was received.</p>");
    expect(rendered.html).toContain("<strong>Lead ID:</strong> lead_123");
    expect(rendered.html).toContain("<strong>Score:</strong> 82");
  });

  test("renders the appointment-confirmation subject, text, and HTML", () => {
    const rendered = renderEmailTemplate({
      template: "appointment_confirmed",
      data: {
        appointment_id: "apt_123",
        business_name: "Pathirana Salon",
        customer_name: "Amaya Silva",
        service: "Hair styling",
        start_time: "2026-09-03T09:00:00+05:30",
        end_time: "2026-09-03T10:00:00+05:30"
      }
    });

    expect(rendered.subject).toBe("Appointment confirmed");
    expect(rendered.text).toContain("An appointment was confirmed.");
    expect(rendered.text).toContain("Appointment ID: apt_123");
    expect(rendered.text).toContain("Customer: Amaya Silva");
    expect(rendered.text).toContain("Service: Hair styling");
    expect(rendered.text).toContain("Start time: 2026-09-03T09:00:00+05:30");
    expect(rendered.text).toContain("End time: 2026-09-03T10:00:00+05:30");
    expect(rendered.html).toContain("<strong>Appointment ID:</strong> apt_123");
    expect(rendered.html).toContain("<strong>Customer:</strong> Amaya Silva");
  });

  test("handles optional new-lead values without placeholder content", () => {
    const rendered = renderEmailTemplate({
      template: "new_lead",
      data: { lead_id: "lead_456", business_name: "Pathirana Salon" }
    });

    expect(rendered.text).not.toContain("Service interest:");
    expect(rendered.text).not.toContain("Platform:");
    expect(rendered.text).not.toContain("Score:");
    expect(rendered.html).not.toContain("undefined");
  });

  test("escapes HTML special characters in every dynamic value", () => {
    const rendered = renderEmailTemplate({
      template: "appointment_confirmed",
      data: {
        appointment_id: "apt_<&>",
        business_name: "A & B",
        customer_name: `O'Reilly \"Customer\"`,
        service: "Cut <Colour>",
        start_time: "<start>",
        end_time: "<end>"
      }
    });

    expect(rendered.html).toContain("apt_&lt;&amp;&gt;");
    expect(rendered.html).toContain("A &amp; B");
    expect(rendered.html).toContain("O&#39;Reilly &quot;Customer&quot;");
    expect(rendered.html).toContain("Cut &lt;Colour&gt;");
  });

  test("renders script-like input as escaped text", () => {
    const script = `<script>alert("x")</script>`;
    const rendered = renderEmailTemplate({
      template: "new_lead",
      data: { lead_id: script, business_name: script, service_interest: script }
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(rendered.text).toContain(script);
  });

  test("rejects an unknown template safely at runtime", () => {
    const unsupported = { template: "password_reset", data: {} } as unknown as EmailTemplateInput;

    expect(() => renderEmailTemplate(unsupported)).toThrow("Unsupported email template");
  });

  test("does not mutate input objects", () => {
    const input: EmailTemplateInput = {
      template: "new_lead",
      data: {
        lead_id: "lead_789",
        business_name: "A & B",
        service_interest: "Cut <Colour>",
        platform: "web",
        score: 0
      }
    };
    const before = structuredClone(input);

    renderEmailTemplate(input);

    expect(input).toEqual(before);
  });
});
