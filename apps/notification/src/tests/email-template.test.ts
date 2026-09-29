import { afterEach, describe, expect, test } from "bun:test";
import { renderEmailTemplate, type EmailTemplateInput } from "../email/templates";

const originalDashboardUrl = process.env.DASHBOARD_BASE_URL;
const originalOffset = process.env.BUSINESS_UTC_OFFSET_MINUTES;
afterEach(() => {
  if (originalDashboardUrl === undefined) delete process.env.DASHBOARD_BASE_URL;
  else process.env.DASHBOARD_BASE_URL = originalDashboardUrl;
  if (originalOffset === undefined) delete process.env.BUSINESS_UTC_OFFSET_MINUTES;
  else process.env.BUSINESS_UTC_OFFSET_MINUTES = originalOffset;
});

const lead: EmailTemplateInput = {
  template: "new_lead",
  data: { lead_id: "lead_123", business_name: "Pathirana Salon", service_interest: "Bridal package", platform: "telegram", score: 0 }
};
const appointment: EmailTemplateInput = {
  template: "appointment_confirmed",
  data: { appointment_id: "apt_123", business_name: "Pathirana Salon", customer_name: "Amaya Silva", service: "Hair styling", start_time: "2026-09-03T09:00:00.000Z", end_time: "2026-09-03T10:00:00.000Z" }
};

describe("email templates", () => {
  test("renders the new lead design with actual data and a zero score", () => {
    const rendered = renderEmailTemplate(lead);
    expect(rendered.subject).toBe("New lead received");
    expect(rendered.text).toContain("You have a new lead");
    expect(rendered.text).toContain("A new lead has been received for Pathirana Salon.");
    expect(rendered.text).toContain("Service interest: Bridal package");
    expect(rendered.text).toContain("Platform: telegram");
    expect(rendered.text).toContain("Lead score: 0");
    expect(rendered.text).toContain("Lead ID: lead_123");
    expect(rendered.html).toContain("<h1");
    expect(rendered.html).toContain("You have a new lead</h1>");
    expect(rendered.html).toContain("Loop</td>");
    expect(rendered.html).toContain("border-bottom: 1px solid #F3F4F6");
    expect(rendered.html).toContain("overflow-wrap: anywhere");
    expect(rendered.html).not.toContain("Acme Services");
  });

  test("formats appointment date and time using the configured business offset", () => {
    process.env.BUSINESS_UTC_OFFSET_MINUTES = "330";
    const rendered = renderEmailTemplate(appointment);
    expect(rendered.subject).toBe("Appointment confirmed");
    expect(rendered.text).toContain("An appointment has been confirmed for Pathirana Salon.");
    expect(rendered.text).toContain("Service: Hair styling");
    expect(rendered.text).toContain("Date: 3 September 2026");
    expect(rendered.text).toContain("Time: 2:30 PM–3:30 PM (UTC+05:30)");
    expect(rendered.text).toContain("Customer: Amaya Silva");
    expect(rendered.text).toContain("Appointment ID: apt_123");
    expect(rendered.html).toContain("Appointment confirmed</h1>");
  });

  test("uses the business-local calendar day across midnight UTC", () => {
    process.env.BUSINESS_UTC_OFFSET_MINUTES = "330";
    const rendered = renderEmailTemplate({ template: "appointment_confirmed", data: {
      ...appointment.data,
      start_time: "2026-09-29T23:30:00.000Z",
      end_time: "2026-09-30T00:30:00.000Z"
    } });
    expect(rendered.text).toContain("Date: 30 September 2026");
    expect(rendered.text).toContain("Time: 5:00 AM–6:00 AM (UTC+05:30)");
  });

  test("keeps raw timestamp data when the payload contains an unparseable date", () => {
    const rendered = renderEmailTemplate({ template: "appointment_confirmed", data: { ...appointment.data, start_time: "<start>", end_time: "<end>" } });
    expect(rendered.text).toContain("Start time: <start>");
    expect(rendered.text).toContain("End time: <end>");
    expect(rendered.html).toContain("&lt;start&gt;");
    expect(rendered.html).toContain("&lt;end&gt;");
  });

  test("omits absent optional lead values", () => {
    const rendered = renderEmailTemplate({ template: "new_lead", data: { lead_id: "lead_456", business_name: "Salon", service_interest: null, platform: null, score: null } });
    expect(rendered.text).not.toContain("Service interest:");
    expect(rendered.text).not.toContain("Platform:");
    expect(rendered.text).not.toContain("Lead score:");
    expect(rendered.html).not.toContain("undefined");
  });

  test("escapes every dynamic HTML value including text and IDs", () => {
    const script = `<script>alert("x")</script>`;
    const rendered = renderEmailTemplate({ template: "new_lead", data: { lead_id: script, business_name: `A & B`, service_interest: `Cut <Colour>`, platform: `O'Reilly`, score: 0 } });
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("A &amp; B");
    expect(rendered.html).toContain("Cut &lt;Colour&gt;");
    expect(rendered.html).toContain("O&#39;Reilly");
    expect(rendered.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(rendered.text).toContain(script);

    const appointmentEmail = renderEmailTemplate({ template: "appointment_confirmed", data: {
      ...appointment.data,
      appointment_id: `apt_<&>`,
      business_name: `A & B`,
      customer_name: `O'Reilly`,
      service: `Cut <Colour>`
    } });
    expect(appointmentEmail.html).toContain("apt_&lt;&amp;&gt;");
    expect(appointmentEmail.html).toContain("A &amp; B");
    expect(appointmentEmail.html).toContain("O&#39;Reilly");
    expect(appointmentEmail.html).toContain("Cut &lt;Colour&gt;");
  });

  test("uses only verified dashboard routes and encodes the lead ID", () => {
    process.env.DASHBOARD_BASE_URL = "https://dashboard.example.test/";
    const leadEmail = renderEmailTemplate({ template: "new_lead", data: { lead_id: "a/b?c&d", business_name: "Salon" } });
    const appointmentEmail = renderEmailTemplate(appointment);
    expect(leadEmail.html).toContain('href="https://dashboard.example.test/leads/a%2Fb%3Fc%26d"');
    expect(leadEmail.text).toContain("View lead: https://dashboard.example.test/leads/a%2Fb%3Fc%26d");
    expect(appointmentEmail.html).toContain('href="https://dashboard.example.test/appointments"');
    expect(appointmentEmail.text).toContain("View appointments: https://dashboard.example.test/appointments");
    expect(appointmentEmail.html).not.toContain("/appointments/apt_123");
  });

  test("omits buttons and links when dashboard origin is absent or invalid", () => {
    for (const url of [undefined, "javascript:alert(1)", "https://user:pass@example.test", "https://example.test/other"]) {
      if (url === undefined) delete process.env.DASHBOARD_BASE_URL;
      else process.env.DASHBOARD_BASE_URL = url;
      for (const input of [lead, appointment]) {
        const rendered = renderEmailTemplate(input);
        expect(rendered.html).not.toContain("<a ");
        expect(rendered.text).not.toContain("View lead:");
        expect(rendered.text).not.toContain("View appointments:");
      }
    }
  });

  test("rejects unknown templates and does not mutate inputs", () => {
    const before = structuredClone(lead);
    renderEmailTemplate(lead);
    expect(lead).toEqual(before);
    expect(() => renderEmailTemplate({ template: "password_reset", data: {} } as unknown as EmailTemplateInput)).toThrow("Unsupported email template");
  });
});
