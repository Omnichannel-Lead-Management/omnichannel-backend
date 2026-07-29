import type { AppointmentStatus } from "../types/appointment";

export type UpdateAppointmentStatusValidationResult =
  | {
      success: true;
      data: {
        status: AppointmentStatus;
      };
    }
  | {
      success: false;
      errors: string[];
    };

const APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
];

export function validateUpdateAppointmentStatus(
  value: unknown
): UpdateAppointmentStatusValidationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      success: false,
      errors: ["Request body must be an object."],
    };
  }

  const statusValue = (value as Record<string, unknown>).status;

  if (statusValue === undefined) {
    return {
      success: false,
      errors: ["status is required."],
    };
  }

  if (typeof statusValue !== "string") {
    return {
      success: false,
      errors: ["status must be a valid appointment status."],
    };
  }

  const status = statusValue.trim().toLowerCase();

  if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    return {
      success: false,
      errors: ["status must be a valid appointment status."],
    };
  }

  return {
    success: true,
    data: {
      status: status as AppointmentStatus,
    },
  };
}
