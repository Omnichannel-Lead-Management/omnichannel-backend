import type { Database } from "bun:sqlite";
import type {
  Appointment,
  CreateAppointmentInput,
} from "../types/appointment";

const INSERT_APPOINTMENT_SQL = `
  INSERT INTO appointments (
    id,
    business_id,
    customer_name,
    customer_email,
    customer_phone,
    service,
    start_time,
    end_time,
    status,
    notes,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export function createAppointment(
  db: Database,
  input: CreateAppointmentInput
): Appointment {
  const timestamp = new Date().toISOString();
  const appointment: Appointment = {
    id: crypto.randomUUID(),
    businessId: input.businessId,
    customerName: input.customerName,
    customerEmail: input.customerEmail ?? null,
    customerPhone: input.customerPhone ?? null,
    service: input.service,
    startTime: input.startTime,
    endTime: input.endTime,
    status: "pending",
    notes: input.notes ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.query(INSERT_APPOINTMENT_SQL).run(
    appointment.id,
    appointment.businessId,
    appointment.customerName,
    appointment.customerEmail,
    appointment.customerPhone,
    appointment.service,
    appointment.startTime,
    appointment.endTime,
    appointment.status,
    appointment.notes,
    appointment.createdAt,
    appointment.updatedAt
  );

  return appointment;
}
