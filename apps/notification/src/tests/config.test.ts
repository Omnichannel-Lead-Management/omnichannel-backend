import { describe, expect, test } from "bun:test";
import { loadNotificationConfig } from "../config";

const validEnvironment = {
  NOTIFICATIONS_ENABLED: "true",
  SMTP_HOST: " sandbox.smtp.example.test ",
  SMTP_PORT: " 2525 ",
  SMTP_USER: " smtp-user ",
  SMTP_PASS: " smtp-password ",
  SMTP_FROM: " Notifications <notifications@example.test> "
};

describe("notification SMTP configuration", () => {
  test("loads a valid Mailtrap-style SMTP configuration", () => {
    expect(loadNotificationConfig(validEnvironment)).toEqual({
      notificationsEnabled: true,
      smtp: {
        host: "sandbox.smtp.example.test",
        port: 2525,
        user: "smtp-user",
        pass: "smtp-password",
        from: "Notifications <notifications@example.test>"
      }
    });
  });

  test("reports every missing required SMTP value", () => {
    expect(() => loadNotificationConfig({ NOTIFICATIONS_ENABLED: "true" })).toThrow(
      "required environment variables are missing: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM"
    );
  });

  test.each(["0", "65536", "25.5", "not-a-port"])(
    "rejects invalid SMTP_PORT %s",
    (SMTP_PORT) => {
      expect(() => loadNotificationConfig({ ...validEnvironment, SMTP_PORT })).toThrow(
        "SMTP_PORT must be an integer from 1 to 65535"
      );
    }
  );

  test("does not require SMTP configuration when notifications are disabled", () => {
    expect(loadNotificationConfig({ NOTIFICATIONS_ENABLED: " FALSE " })).toEqual({
      notificationsEnabled: false,
      smtp: null
    });
  });

  test("never includes credential values in validation errors", () => {
    const secretUser = "private-user-value";
    const secretPass = "private-password-value";

    try {
      loadNotificationConfig({
        ...validEnvironment,
        SMTP_PORT: "invalid",
        SMTP_USER: secretUser,
        SMTP_PASS: secretPass
      });
      throw new Error("Expected configuration validation to fail");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secretUser);
      expect(message).not.toContain(secretPass);
      expect(message).toBe("SMTP_PORT must be an integer from 1 to 65535");
    }
  });
});
