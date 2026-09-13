import type { Database } from "bun:sqlite";
import type {
  Appointment,
  AppointmentStatus,
  CreateAppointmentInput,
} from "../types/appointment";
import {
  closeHourLocal,
  localDateTimeToUtc,
  openHourLocal,
  type DayWindow,
} from "./business-hours";

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
  WHERE id = ? AND business_id = ? AND status = ?
  RETURNING *
`;

const APPOINTMENT_CONFLICT_SQL = `
  SELECT id
  FROM appointments
  WHERE business_id = ?
    AND status IN ('pending', 'confirmed')
    AND start_time < ?
    AND end_time > ?
  LIMIT 1
`;

const ACTIVE_APPOINTMENTS_FOR_DATE_SQL = `
  SELECT
    start_time,
    end_time
  FROM appointments
  WHERE business_id = ?
    AND status IN ('pending', 'confirmed')
    AND start_time < ?
    AND end_time > ?
  ORDER BY start_time ASC
`;

const SLOT_DURATION_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

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

export type CreateAppointmentAvailabilityResult =
  | {
      result: "created";
      appointment: Appointment;
    }
  | {
      result: "conflict";
    };

export type AppointmentAvailabilitySlot = {
  startTime: string;
  endTime: string;
};

interface ActiveAppointmentTimeRow {
  start_time: string;
  end_time: string;
}

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

export function hasAppointmentConflict(
  db: Database,
  businessId: string,
  startTime: string,
  endTime: string
): boolean {
  const conflictingAppointment = db
    .query<{ id: string }, [string, string, string]>(
      APPOINTMENT_CONFLICT_SQL
    )
    .get(businessId, endTime, startTime);

  return conflictingAppointment !== null;
}

export function createAppointmentIfAvailable(
  db: Database,
  input: CreateAppointmentInput
): CreateAppointmentAvailabilityResult {
  const transaction = db.transaction(
    (): CreateAppointmentAvailabilityResult => {
      if (
        hasAppointmentConflict(
          db,
          input.businessId,
          input.startTime,
          input.endTime
        )
      ) {
        return { result: "conflict" };
      }

      return {
        result: "created",
        appointment: createAppointment(db, input),
      };
    }
  );

  return transaction();
}

export function getAvailableAppointmentSlots(
  db: Database,
  businessId: string,
  date: string,
  window: DayWindow | null = {
    openMinutes: openHourLocal() * 60,
    closeMinutes: closeHourLocal() * 60,
  }
): AppointmentAvailabilitySlot[] {
  if (!window) return [];

  const requestedDateStart = localDateTimeToUtc(date, "00:00");
  if (!requestedDateStart) return [];

  const followingDateStart = new Date(requestedDateStart.getTime() + 24 * HOUR_MS);
  const openingTime = new Date(requestedDateStart.getTime() + window.openMinutes * MINUTE_MS);
  const closingTime = new Date(requestedDateStart.getTime() + window.closeMinutes * MINUTE_MS);

  const activeAppointments = db
    .query<ActiveAppointmentTimeRow, [string, string, string]>(
      ACTIVE_APPOINTMENTS_FOR_DATE_SQL
    )
    .all(
      businessId,
      followingDateStart.toISOString(),
      requestedDateStart.toISOString()
    );

  const slots: AppointmentAvailabilitySlot[] = [];

  for (
    let slotStart = openingTime.getTime();
    slotStart < closingTime.getTime();
    slotStart += SLOT_DURATION_MS
  ) {
    const slotEnd = slotStart + SLOT_DURATION_MS;
    const isBlocked = activeAppointments.some((appointment) => {
      const appointmentStart = Date.parse(appointment.start_time);
      const appointmentEnd = Date.parse(appointment.end_time);
      return appointmentStart < slotEnd && appointmentEnd > slotStart;
    });

    if (!isBlocked) {
      slots.push({
        startTime: new Date(slotStart).toISOString(),
        endTime: new Date(slotEnd).toISOString(),
      });
    }
  }

  return slots;
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

  // Compare-and-set: a competing confirmation cannot claim the same transition.
  const row = db.query<AppointmentRow, [string, string, string, string, string]>(
    UPDATE_APPOINTMENT_STATUS_SQL
  ).get(status, updatedAt, appointmentId, currentAppointment.businessId, currentAppointment.status);

  if (!row) return { result: "invalid_transition" };

  return { result: "updated", appointment: mapAppointmentRow(row) };
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
