export const PORTS = {
  GATEWAY: 3000,
  ROUTING: 3001,
  LEAD_MANAGER: 3002,
  CHATBOT: 3003,
  NOTIFICATION: 3004,
  APPOINTMENT: 3005,
} as const;

export const SERVICE_URLS = {
  GATEWAY: process.env.GATEWAY_URL ?? "http://localhost:3000",
  ROUTING: process.env.ROUTING_SERVICE_URL ?? "http://localhost:3001",
  LEAD_MANAGER: process.env.LEAD_MANAGER_URL ?? "http://localhost:3002",
  CHATBOT: process.env.CHATBOT_ENGINE_URL ?? "http://localhost:3003",
  NOTIFICATION: process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3004",
  APPOINTMENT: process.env.APPOINTMENT_SERVICE_URL ?? "http://localhost:3005",
} as const;
