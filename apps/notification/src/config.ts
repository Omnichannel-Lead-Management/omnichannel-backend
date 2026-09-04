export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface NotificationConfig {
  notificationsEnabled: boolean;
  smtp: SmtpConfig | null;
}

type Environment = Record<string, string | undefined>;

const SMTP_VARIABLES = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;

function trimmed(env: Environment, name: (typeof SMTP_VARIABLES)[number]): string {
  return env[name]?.trim() ?? "";
}

/**
 * Loads and validates notification delivery configuration without exposing
 * credential values in validation errors.
 *
 * The existing NOTIFICATIONS_ENABLED convention enables notifications unless
 * the value is explicitly set to "false" (case-insensitive).
 */
export function loadNotificationConfig(env: Environment = process.env): NotificationConfig {
  const notificationsEnabled = env.NOTIFICATIONS_ENABLED?.trim().toLowerCase() !== "false";

  if (!notificationsEnabled) {
    return { notificationsEnabled: false, smtp: null };
  }

  const values = Object.fromEntries(
    SMTP_VARIABLES.map((name) => [name, trimmed(env, name)])
  ) as Record<(typeof SMTP_VARIABLES)[number], string>;
  const missing = SMTP_VARIABLES.filter((name) => !values[name]);

  if (missing.length > 0) {
    throw new Error(
      `Notification email delivery is enabled, but required environment variables are missing: ${missing.join(
        ", "
      )}`
    );
  }

  if (!/^\d+$/.test(values.SMTP_PORT)) {
    throw new Error("SMTP_PORT must be an integer from 1 to 65535");
  }

  const port = Number(values.SMTP_PORT);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be an integer from 1 to 65535");
  }

  return {
    notificationsEnabled: true,
    smtp: {
      host: values.SMTP_HOST,
      port,
      user: values.SMTP_USER,
      pass: values.SMTP_PASS,
      from: values.SMTP_FROM
    }
  };
}
