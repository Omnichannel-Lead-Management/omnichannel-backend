/**
 * Sets (or resets) a business owner's dashboard password.
 *
 * Businesses registered before authentication existed have no password_hash,
 * so nobody can sign in to them. This is how you give an existing tenant its
 * first password. Run it on the host, inside the gateway container, so it uses
 * the same DATABASE_URL the service does:
 *
 *   docker compose --env-file .env exec -T gateway \
 *     bun run scripts/set-business-password.ts <business-id|owner-email> '<password>'
 *
 * Passing the password as an argument leaves it in the shell history; prefer
 * piping it on stdin:
 *
 *   printf '%s' '<password>' | docker compose --env-file .env exec -T gateway \
 *     bun run scripts/set-business-password.ts <business-id|owner-email>
 */

import {
  getBusinessById,
  getBusinessByOwnerEmail,
  setBusinessPassword
} from "../src/services/BusinessRegistry";
import { MIN_PASSWORD_LENGTH, sessionAuthService } from "../src/services/SessionAuth";

async function readPassword(argv: string[]): Promise<string> {
  const fromArgs = argv[1];
  if (fromArgs) return fromArgs;

  if (process.stdin.isTTY) return "";
  return (await Bun.stdin.text()).replace(/\r?\n$/, "");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const selector = argv[0]?.trim();

  if (!selector) {
    console.error(
      "Usage: bun run scripts/set-business-password.ts <business-id|owner-email> [password]"
    );
    return 2;
  }

  const password = await readPassword(argv);
  if (!password) {
    console.error("No password supplied (pass it as an argument or pipe it on stdin).");
    return 2;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    return 2;
  }

  const business = selector.includes("@")
    ? await getBusinessByOwnerEmail(selector)
    : await getBusinessById(selector);

  if (!business) {
    console.error(`No business matched "${selector}".`);
    return 1;
  }

  const hash = await sessionAuthService.hashPassword(password);
  const updated = await setBusinessPassword(business.id, hash);
  if (!updated) {
    console.error(`Failed to update ${business.id}.`);
    return 1;
  }

  // The owner email is the login identifier, so print it to catch the case
  // where a tenant has none and still could not sign in.
  console.log(`Password set for ${business.id} (${business.name}).`);
  if (!business.owner_email) {
    console.warn(
      "⚠️  This business has no owner_email, so there is no way to sign in yet. " +
        "Set one via PATCH /api/businesses/:id first."
    );
  } else {
    console.log(`Sign in with: ${business.owner_email}`);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("Failed to set password:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
