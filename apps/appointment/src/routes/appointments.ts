import type { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import {
  createAppointmentIfAvailable,
  getAvailableAppointmentSlots,
  getAppointmentById,
  listAppointmentsByBusiness,
  updateAppointmentStatus,
} from "../services/appointment-service";
import {
  isWithinOpeningHours,
  openingHoursLabel,
  resolveDayWindow,
  utcToLocalDate,
} from "../services/business-hours";
import { getBusinessHours } from "../services/business-hours-provider";
import { validateAvailabilityQuery } from "../validation/availability-query";
import { validateCreateAppointmentInput } from "../validation/create-appointment";
import { validateUpdateAppointmentStatus } from "../validation/update-appointment-status";

import { sendConfirmationEmail, type ConfirmationEmailDependencies } from "../services/confirmation-email";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAppointmentRoutes(db: Database, emailDependencies?: ConfirmationEmailDependencies): Elysia {
  return new Elysia({ prefix: "/api/appointments" })
    .post("/", async ({ body, set }) => {
      const validation = validateCreateAppointmentInput(body);

      if (!validation.success) {
        set.status = 400;
        return {
          success: false,
          message: "Invalid appointment request.",
          errors: validation.errors,
        };
      }

      try {
        const hours = await getBusinessHours(validation.data.businessId);
        if (hours) {
          const startUtc = new Date(validation.data.startTime);
          const endUtc = new Date(validation.data.endTime);
          const window = resolveDayWindow(hours, utcToLocalDate(startUtc));

          if (!isWithinOpeningHours(startUtc, endUtc, window)) {
            set.status = 422;
            return {
              success: false,
              message: window
                ? `The business is only open ${openingHoursLabel(window)} on that day.`
                : "The business is closed on that day.",
            };
          }
        }

        const result = createAppointmentIfAvailable(db, validation.data);

        if (result.result === "conflict") {
          set.status = 409;
          return {
            success: false,
            message: "The requested appointment time is not available.",
          };
        }

        set.status = 201;

        return {
          success: true,
          data: result.appointment,
        };
      } catch (error) {
        console.error("Failed to create appointment.", error);
        set.status = 500;
        return {
          success: false,
          message: "Failed to create appointment.",
        };
      }
    })
    .get("/", ({ query, set }) => {
      const businessId =
        typeof query.businessId === "string" ? query.businessId.trim() : "";

      if (businessId.length === 0) {
        set.status = 400;
        return {
          success: false,
          message: "businessId is required.",
        };
      }

      try {
        return {
          success: true,
          data: listAppointmentsByBusiness(db, businessId),
        };
      } catch {
        set.status = 500;
        return {
          success: false,
          message: "Failed to retrieve appointments.",
        };
      }
    })
    .get("/availability", async ({ query, set }) => {
      const validation = validateAvailabilityQuery(query);

      if (!validation.success) {
        set.status = 400;
        return {
          success: false,
          message: "Invalid availability request.",
          errors: validation.errors,
        };
      }

      try {
        const { businessId, date } = validation.data;

        const hours = await getBusinessHours(businessId);
        const window = resolveDayWindow(hours, date);

        return {
          success: true,
          data: {
            businessId,
            date,
            slots: getAvailableAppointmentSlots(db, businessId, date, window),
            openingHours: openingHoursLabel(window),
            closed: window === null,
          },
        };
      } catch (error) {
        console.error("Failed to retrieve appointment availability.", error);
        set.status = 500;
        return {
          success: false,
          message: "Failed to retrieve appointment availability.",
        };
      }
    })
    .get("/:id", ({ params, set }) => {
      const appointmentId = normalizeAppointmentId(params.id);

      if (!appointmentId) {
        set.status = 400;
        return {
          success: false,
          message: "Invalid appointment ID.",
        };
      }

      try {
        const appointment = getAppointmentById(db, appointmentId);

        if (!appointment) {
          set.status = 404;
          return {
            success: false,
            message: "Appointment not found.",
          };
        }

        return {
          success: true,
          data: appointment,
        };
      } catch {
        set.status = 500;
        return {
          success: false,
          message: "Failed to retrieve appointment.",
        };
      }
    })
    .patch("/:id/status", async ({ params, body, set }) => {
      const appointmentId = normalizeAppointmentId(params.id);

      if (!appointmentId) {
        set.status = 400;
        return {
          success: false,
          message: "Invalid appointment ID.",
        };
      }

      const validation = validateUpdateAppointmentStatus(body);

      if (!validation.success) {
        set.status = 400;
        return {
          success: false,
          message: "Invalid appointment status request.",
          errors: validation.errors,
        };
      }

      try {
        const result = updateAppointmentStatus(
          db,
          appointmentId,
          validation.data.status
        );

        if (result.result === "not_found") {
          set.status = 404;
          return {
            success: false,
            message: "Appointment not found.",
          };
        }

        if (result.result === "invalid_transition") {
          set.status = 409;
          return {
            success: false,
            message: "Appointment status transition is not allowed.",
          };
        }

        if (result.appointment.status === "confirmed") {
          await sendConfirmationEmail(result.appointment, emailDependencies);
        }

        return {
          success: true,
          data: result.appointment,
        };
      } catch (error) {
        console.error("Failed to update appointment status.", error);
        set.status = 500;
        return {
          success: false,
          message: "Failed to update appointment status.",
        };
      }
    });
}

function normalizeAppointmentId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const appointmentId = value.trim().toLowerCase();
  return UUID_PATTERN.test(appointmentId) ? appointmentId : null;
}
