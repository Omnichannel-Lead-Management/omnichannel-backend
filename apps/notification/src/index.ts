import { createApp } from "./app";
import { createDatabase, initializeDatabase } from "./db";

const PORT = Number(process.env.PORT ?? 3004);

const db = createDatabase();
initializeDatabase(db);

const app = createApp(db);
app.listen(PORT);

console.log(`Notification Service listening on http://localhost:${PORT}`);
