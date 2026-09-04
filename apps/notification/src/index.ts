import { createApp } from "./app";
import { loadNotificationConfig } from "./config";
import { createDatabase, initializeDatabase } from "./db";
import { SmtpEmailProvider } from "./email/providers/smtp-email-provider";
import { TemplatedEmailService } from "./email/services";

const PORT = Number(process.env.PORT ?? 3004);
const config = loadNotificationConfig();

const db = createDatabase();
initializeDatabase(db);

const emailService = config.smtp
  ? new TemplatedEmailService(new SmtpEmailProvider(config.smtp))
  : undefined;
const app = createApp(db, {
  notificationsEnabled: config.notificationsEnabled,
  ...(emailService ? { emailService } : {})
});
app.listen(PORT);

console.log(`Notification Service listening on http://localhost:${PORT}`);
