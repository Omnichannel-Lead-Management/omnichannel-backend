import type { CreateAppointmentInput } from "../types/appointment";

export type ValidationResult =
  | {
      success: true;
      data: CreateAppointmentInput;
    }
  | {
      success: false;
      errors: string[];
    };

const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCreateAppointmentInput(
  value: unknown
): ValidationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      success: false,
      errors: ["Request body must be an object."],
    };
  }

  const body = value as Record<string, unknown>;
  const errors: string[] = [];

  const businessId = readRequiredString(body, "businessId", errors);
  const customerName = readRequiredString(body, "customerName", errors);
  const service = readRequiredString(body, "service", errors);
  const startTime = readDateTime(body, "startTime", errors);
  const endTime = readDateTime(body, "endTime", errors);
  const customerEmail = readEmail(body, errors);
  const customerPhone = readOptionalString(body, "customerPhone", errors);
  const notes = readOptionalString(body, "notes", errors);

  if (
    startTime !== null &&
    endTime !== null &&
    new Date(endTime).getTime() <= new Date(startTime).getTime()
  ) {
    errors.push("endTime must be later than startTime.");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      businessId: businessId!,
      customerName: customerName!,
      customerEmail,
      customerPhone,
      service: service!,
      startTime: startTime!,
      endTime: endTime!,
      notes,
    },
  };
}

function readRequiredString(
  body: Record<string, unknown>,
  field: string,
  errors: string[]
): string | null {
  const value = body[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} is required.`);
    return null;
  }

  return value.trim();
}

function readDateTime(
  body: Record<string, unknown>,
  field: string,
  errors: string[]
): string | null {
  const value = body[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} is required.`);
    return null;
  }

  const trimmed = value.trim();
  const date = new Date(trimmed);

  if (!ISO_DATE_TIME_PATTERN.test(trimmed) || Number.isNaN(date.getTime())) {
    errors.push(`${field} must be a valid ISO date-time string.`);
    return null;
  }

  return date.toISOString();
}

function readEmail(
  body: Record<string, unknown>,
  errors: string[]
): string | null {
  const value = body.customerEmail;

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || !EMAIL_PATTERN.test(value.trim())) {
    errors.push("customerEmail must be a valid email address.");
    return null;
  }

  return value.trim();
}

function readOptionalString(
  body: Record<string, unknown>,
  field: string,
  errors: string[]
): string | null {
  const value = body[field];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    errors.push(`${field} must be a string or null.`);
    return null;
  }

  return value.trim();
}
