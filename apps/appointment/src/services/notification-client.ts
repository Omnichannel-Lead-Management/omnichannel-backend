export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Deadline includes reading the response body; no retries, even on timeout. */
export async function requestJson(
  fetcher: HttpFetch, url: string, timeoutMs: number, init?: RequestInit
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, { ...init, signal: controller.signal });
        if (!response.ok) throw new Error("HTTP request failed");
        return response.json();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("HTTP request timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface AppointmentEmailRequest {
  business_id: string;
  recipient_email: string;
  template: "appointment_confirmed";
  data: {
    appointment_id: string;
    business_name: string;
    customer_name: string;
    service: string;
    start_time: string;
    end_time: string;
  };
}

export interface NotificationClient {
  sendEmail(request: AppointmentEmailRequest): Promise<void>;
}

export function createNotificationClient(options: {
  url?: string; fetcher?: HttpFetch; timeoutMs?: number;
} = {}): NotificationClient {
  const url = (options.url ?? process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3004").replace(/\/$/, "");
  return {
    async sendEmail(request) {
      // Notification Service's SMTP deadline is 10s; allow 2s HTTP overhead.
      const body = await requestJson(options.fetcher ?? fetch, `${url}/api/notifications/email`, options.timeoutMs ?? 12_000, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }) as { success?: boolean; email_sent?: boolean } | null;
      if (body?.success !== true || body.email_sent !== true) throw new Error("Email not sent");
    },
  };
}
