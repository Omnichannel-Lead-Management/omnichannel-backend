export interface NewLeadTemplateData {
  lead_id: string;
  business_name: string;
  service_interest?: string | null;
  platform?: string | null;
  score?: number | null;
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

type Detail = [label: string, value: string | number];
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function escapeHtml(value: string | number): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Accept an explicit dashboard origin only; never use an API URL as the email target. */
function dashboardUrl(path: string): string | null {
  const configured = process.env.DASHBOARD_BASE_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") return null;
    return `${url.origin}${path}`;
  } catch { return null; }
}

function detailRows(details: Detail[]): string {
  return details.map(([label, value], index) => {
    const border = index === details.length - 1 ? "" : "border-bottom: 1px solid #F3F4F6;";
    const mono = label.endsWith(" ID") ? "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;" : "";
    return `<tr><td class="detail-label" style="width: 38%; padding: 10px 12px 10px 0; font-size: 14px; line-height: 1.5; color: #6B7280; vertical-align: top; ${border}">${escapeHtml(label)}</td>` +
      `<td class="detail-value" style="width: 62%; padding: 10px 0; font-size: 14px; line-height: 1.5; font-weight: 500; color: #111827; vertical-align: top; overflow-wrap: anywhere; word-break: break-word; ${mono} ${border}"><strong style="font-weight: 500;">${escapeHtml(value)}</strong></td></tr>`;
  }).join("");
}

function renderLayout(heading: string, introduction: string, details: Detail[], action: { url: string; label: string } | null): string {
  const button = action ? `<tr><td style="padding-bottom: 48px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" bgcolor="#6366D9" style="background-color: #6366D9; border-radius: 6px; text-align: center;"><a href="${escapeHtml(action.url)}" target="_blank" style="display: block; padding: 13px 20px; font-family: ${FONT}; font-size: 15px; line-height: 1.4; font-weight: 500; color: #FFFFFF; text-decoration: none; border-radius: 6px;">${escapeHtml(action.label)}</a></td></tr></table></td></tr>` : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(heading)}</title><style>
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    @media screen and (max-width: 620px) { .email-outer { padding: 32px 20px 48px !important; } .email-container { width: 100% !important; } }
  </style></head><body style="margin: 0; padding: 0; width: 100%; background-color: #FFFFFF; font-family: ${FONT}; color: #374151;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #FFFFFF;"><tr><td class="email-outer" align="center" style="padding: 40px 16px 60px;"><table class="email-container" role="presentation" cellpadding="0" cellspacing="0" border="0" width="580" style="width: 100%; max-width: 580px; text-align: left;">
    <tr><td style="padding-bottom: 36px; font-family: ${FONT}; font-size: 20px; line-height: 28px; font-weight: 700; color: #111827;">Loop</td></tr>
    <tr><td style="padding-bottom: 12px;"><h1 style="margin: 0; font-family: ${FONT}; font-size: 24px; line-height: 1.3; font-weight: 600; letter-spacing: -0.4px; color: #111827;">${escapeHtml(heading)}</h1></td></tr>
    <tr><td style="padding-bottom: 32px;"><p style="margin: 0; font-family: ${FONT}; font-size: 15px; line-height: 1.6; color: #4B5563;">${escapeHtml(introduction)}</p></td></tr>
    <tr><td style="padding-bottom: 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">${detailRows(details)}</table></td></tr>
    ${button}
    <tr><td style="border-top: 1px solid #E5E7EB; padding-top: 24px;"><p style="margin: 0 0 6px; font-family: ${FONT}; font-size: 13px; font-weight: 600; color: #9CA3AF;">Loop</p><p style="margin: 0; font-family: ${FONT}; font-size: 13px; line-height: 1.5; color: #9CA3AF;">Automated notification for your business.</p></td></tr>
  </table></td></tr></table></body></html>`;
}

function renderText(heading: string, introduction: string, details: Detail[], action: { url: string; label: string } | null): string {
  return [heading, "", introduction, "", ...details.map(([label, value]) => `${label}: ${value}`),
    ...(action ? ["", `${action.label}: ${action.url}`] : []), "", "Loop", "Automated notification for your business."].join("\n");
}

/** Match the appointment service's BUSINESS_UTC_OFFSET_MINUTES convention. */
function businessOffsetMinutes(): number {
  const configured = process.env.BUSINESS_UTC_OFFSET_MINUTES;
  if (!configured?.trim()) return 0;
  const parsed = Number(configured);
  return Number.isFinite(parsed) ? parsed : 0;
}

function appointmentDateTime(start: string, end: string): { date: string; time: string } | null {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  const offset = businessOffsetMinutes();
  const shiftedStart = new Date(startDate.getTime() + offset * 60_000);
  const shiftedEnd = new Date(endDate.getTime() + offset * 60_000);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(shiftedStart);
  const formatTime = (value: Date) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(value);
  const sign = offset < 0 ? "−" : "+";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return { date, time: `${formatTime(shiftedStart)}–${formatTime(shiftedEnd)} (UTC${sign}${hours}:${minutes})` };
}

function renderNewLead(data: NewLeadTemplateData): RenderedEmail {
  const heading = "You have a new lead";
  const introduction = `A new lead has been received for ${data.business_name}.`;
  const details: Detail[] = [];
  if (data.service_interest != null) details.push(["Service interest", data.service_interest]);
  if (data.platform != null) details.push(["Platform", data.platform]);
  if (data.score != null) details.push(["Lead score", data.score]);
  details.push(["Lead ID", data.lead_id]);
  const url = dashboardUrl(`/leads/${encodeURIComponent(data.lead_id)}`);
  const action = url ? { url, label: "View lead" } : null;
  return { subject: "New lead received", text: renderText(heading, introduction, details, action), html: renderLayout(heading, introduction, details, action) };
}

function renderAppointmentConfirmed(data: AppointmentConfirmedTemplateData): RenderedEmail {
  const heading = "Appointment confirmed";
  const introduction = `An appointment has been confirmed for ${data.business_name}.`;
  const dateTime = appointmentDateTime(data.start_time, data.end_time);
  const details: Detail[] = [["Service", data.service]];
  if (dateTime) details.push(["Date", dateTime.date], ["Time", dateTime.time]);
  else details.push(["Start time", data.start_time], ["End time", data.end_time]);
  details.push(["Customer", data.customer_name], ["Appointment ID", data.appointment_id]);
  const url = dashboardUrl("/appointments");
  const action = url ? { url, label: "View appointments" } : null;
  return { subject: "Appointment confirmed", text: renderText(heading, introduction, details, action), html: renderLayout(heading, introduction, details, action) };
}

export function renderEmailTemplate(input: EmailTemplateInput): RenderedEmail {
  switch (input.template) {
    case "new_lead": return renderNewLead(input.data);
    case "appointment_confirmed": return renderAppointmentConfirmed(input.data);
    default: throw new Error("Unsupported email template");
  }
}
