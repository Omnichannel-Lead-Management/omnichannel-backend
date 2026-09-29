/**
 * Creates (or resets the password of) a platform admin.
 *
 * Platform admins are deliberately not self-service: there is no public
 * "register as admin" endpoint, because anyone who reached it would be able to
 * read every tenant's usage. The first admin is created here, on the host, by
 * someone who already has access to the machine.
 *
 *   printf '%s' '<password>' | docker compose --env-file .env exec -T gateway \
 *     bun run scripts/create-platform-admin.ts <email> [--owner] [--name "Full Name"]
 *
 * Passing the password as a trailing argument also works but leaves it in the
 * shell history, so prefer stdin. Re-running for an existing email resets that
 * admin's password rather than failing.
 */

import {
  createAdmin,
  getAdminByEmail,
  setAdminActive,
  setAdminPassword
} from "../src/services/AdminRegistry";
import { adminAuthService } from "../src/services/AdminAuth";
import { MIN_PASSWORD_LENGTH } from "../src/services/SessionAuth";
import { initDatabase } from "../src/db";

interface Args {
  email: string;
  password: string;
  owner: boolean;
  name: string;
}

async function parseArgs(argv: string[]): Promise<Args | string> {
  const positional: string[] = [];
  let owner = false;
  let name = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--owner") owner = true;
    else if (arg === "--name") name = argv[++i] ?? "";
    else positional.push(arg);
  }

  const email = positional[0]?.trim() ?? "";
  if (!email.includes("@")) return "An email address is required.";

  const password =
    positional[1] ?? (process.stdin.isTTY ? "" : (await Bun.stdin.text()).replace(/\r?\n$/, ""));

  if (!password) return "No password supplied (pass it as an argument or pipe it on stdin).";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return { email, password, owner, name };
}

async function main(): Promise<number> {
  if (!adminAuthService.configured) {
    console.warn(
      "⚠️  ADMIN_JWT_SECRET is not set. The account will be created, but the " +
        "admin console stays disabled until the gateway has that secret."
    );
  }

  const parsed = await parseArgs(process.argv.slice(2));
  if (typeof parsed === "string") {
    console.error(parsed);
    console.error(
      "Usage: bun run scripts/create-platform-admin.ts <email> [password] [--owner] [--name \"Full Name\"]"
    );
    return 2;
  }

  // The table may not exist yet on a gateway that has never booted this build.
  await initDatabase();

  const existing = await getAdminByEmail(parsed.email);
  if (existing) {
    await setAdminPassword(existing.id, parsed.password);
    // Resetting a password is also how you recover a deactivated account.
    if (existing.is_active !== 1) await setAdminActive(existing.id, true);
    console.log(`Password reset for existing admin ${existing.email} (${existing.role}).`);
    return 0;
  }

  const admin = await createAdmin({
    email: parsed.email,
    password: parsed.password,
    name: parsed.name || undefined,
    role: parsed.owner ? "owner" : "staff"
  });

  console.log(`Created ${admin.role} admin ${admin.email}.`);
  console.log("Sign in at /admin/login with that address and password.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("Failed to create the admin:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
