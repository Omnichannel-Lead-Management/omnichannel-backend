import type { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import {
  createAppointment,
  getAppointmentById,
  listAppointmentsByBusiness,
} from "../services/appointment-service";
import { validateCreateAppointmentInput } from "../validation/create-appointment";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAppointmentRoutes(db: Database): Elysia {
  return new Elysia({ prefix: "/api/appointments" })
    .post("/", ({ body, set }) => {
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
        const appointment = createAppointment(db, validation.data);
        set.status = 201;

        return {
          success: true,
          data: appointment,
        };
      } catch {
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
    .get("/:id", ({ params, set }) => {
      const appointmentId =
        typeof params.id === "string" ? params.id.trim().toLowerCase() : "";

      if (!UUID_PATTERN.test(appointmentId)) {
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
    });
}
