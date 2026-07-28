import type { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { createAppointment } from "../services/appointment-service";
import { validateCreateAppointmentInput } from "../validation/create-appointment";

export function createAppointmentRoutes(db: Database): Elysia {
  return new Elysia({ prefix: "/api/appointments" }).post(
    "/",
    ({ body, set }) => {
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
    }
  );
}
