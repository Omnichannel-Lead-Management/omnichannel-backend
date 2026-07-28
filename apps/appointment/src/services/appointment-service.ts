import type { Database } from "bun:sqlite";
import type {
  Appointment,
  AppointmentStatus,
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

const LIST_APPOINTMENTS_BY_BUSINESS_SQL = `
  SELECT
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
  FROM appointments
  WHERE business_id = ?
  ORDER BY start_time ASC
`;

const GET_APPOINTMENT_BY_ID_SQL = `
  SELECT
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
  FROM appointments
  WHERE id = ?
  LIMIT 1
`;

const UPDATE_APPOINTMENT_STATUS_SQL = `
  UPDATE appointments
  SET
    status = ?,
    updated_at = ?
  WHERE id = ?
`;

const ALLOWED_STATUS_TRANSITIONS: Record<
  AppointmentStatus,
  readonly AppointmentStatus[]
> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["completed", "cancelled"],
  cancelled: [],
  completed: [],
};

export type UpdateAppointmentStatusResult =
  | {
      result: "updated";
      appointment: Appointment;
    }
  | {
      result: "not_found";
    }
  | {
      result: "invalid_transition";
    };

interface AppointmentRow {
  id: string;
  business_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  service: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

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

export function listAppointmentsByBusiness(
  db: Database,
  businessId: string
): Appointment[] {
  const rows = db
    .query<AppointmentRow, [string]>(LIST_APPOINTMENTS_BY_BUSINESS_SQL)
    .all(businessId);

  return rows.map(mapAppointmentRow);
}

export function getAppointmentById(
  db: Database,
  appointmentId: string
): Appointment | null {
  const row = db
    .query<AppointmentRow, [string]>(GET_APPOINTMENT_BY_ID_SQL)
    .get(appointmentId);

  return row ? mapAppointmentRow(row) : null;
}

export function updateAppointmentStatus(
  db: Database,
  appointmentId: string,
  status: AppointmentStatus
): UpdateAppointmentStatusResult {
  const currentAppointment = getAppointmentById(db, appointmentId);

  if (!currentAppointment) {
    return { result: "not_found" };
  }

  const allowedStatuses =
    ALLOWED_STATUS_TRANSITIONS[currentAppointment.status];

  if (!allowedStatuses.includes(status)) {
    return { result: "invalid_transition" };
  }

  const updatedAt = new Date().toISOString();

  db.query(UPDATE_APPOINTMENT_STATUS_SQL).run(
    status,
    updatedAt,
    appointmentId
  );

  return {
    result: "updated",
    appointment: {
      ...currentAppointment,
      status,
      updatedAt,
    },
  };
}

function mapAppointmentRow(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    businessId: row.business_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    service: row.service,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
