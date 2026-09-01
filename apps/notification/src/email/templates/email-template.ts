export interface NewLeadTemplateData {
  lead_id: string;
  business_name: string;
  service_interest?: string;
  platform?: string;
  score?: number;
}

export interface AppointmentConfirmedTemplateData {
  appointment_id: string;
  business_name: string;
  customer_name: string;
  service: string;
  start_time: string;
  end_time: string;
}

export type EmailTemplateInput =
  | { template: "new_lead"; data: NewLeadTemplateData }
  | { template: "appointment_confirmed"; data: AppointmentConfirmedTemplateData };

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textLine(label: string, value: string | number): string {
  return `${label}: ${value}`;
}

function htmlLine(label: string, value: string | number): string {
  return `<li><strong>${label}:</strong> ${escapeHtml(value)}</li>`;
}

function renderNewLead(data: NewLeadTemplateData): RenderedEmail {
  const details: Array<[string, string | number]> = [
    ["Business", data.business_name],
    ["Lead ID", data.lead_id]
  ];

  if (data.service_interest !== undefined) details.push(["Service interest", data.service_interest]);
  if (data.platform !== undefined) details.push(["Platform", data.platform]);
  if (data.score !== undefined) details.push(["Score", data.score]);

  return {
    subject: "New lead received",
    text: ["A new lead was received.", "", ...details.map(([label, value]) => textLine(label, value))].join(
      "\n"
    ),
    html: [
      "<p>A new lead was received.</p>",
      `<ul>${details.map(([label, value]) => htmlLine(label, value)).join("")}</ul>`
    ].join("")
  };
}

function renderAppointmentConfirmed(data: AppointmentConfirmedTemplateData): RenderedEmail {
  const details: Array<[string, string]> = [
    ["Business", data.business_name],
    ["Appointment ID", data.appointment_id],
    ["Customer", data.customer_name],
    ["Service", data.service],
    ["Start time", data.start_time],
    ["End time", data.end_time]
  ];

  return {
    subject: "Appointment confirmed",
    text: [
      "An appointment was confirmed.",
      "",
      ...details.map(([label, value]) => textLine(label, value))
    ].join("\n"),
    html: [
      "<p>An appointment was confirmed.</p>",
      `<ul>${details.map(([label, value]) => htmlLine(label, value)).join("")}</ul>`
    ].join("")
  };
}

export function renderEmailTemplate(input: EmailTemplateInput): RenderedEmail {
  switch (input.template) {
    case "new_lead":
      return renderNewLead(input.data);
    case "appointment_confirmed":
      return renderAppointmentConfirmed(input.data);
    default:
      throw new Error("Unsupported email template");
  }
}
