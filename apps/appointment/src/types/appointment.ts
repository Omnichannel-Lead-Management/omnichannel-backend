export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed";

export interface Appointment {
  id: string;
  businessId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  service: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppointmentInput {
  businessId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  service: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
}
