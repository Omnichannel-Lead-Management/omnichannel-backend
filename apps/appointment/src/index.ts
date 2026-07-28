import { createApp } from "./app";
import { createDatabase } from "./db/database";
import { initializeDatabase } from "./db/initialize";

const PORT = Number(process.env.PORT ?? 3005);

const db = createDatabase();
initializeDatabase(db);

const app = createApp(db);
app.listen(PORT);

console.log(`Appointment Service listening on http://localhost:${PORT}`);
