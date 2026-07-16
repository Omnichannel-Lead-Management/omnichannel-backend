interface CliOptions {
  agentId: string;
  agentName: string;
  expiresInSeconds: number;
  issuer?: string;
  audience?: string;
}

function printUsageAndExit(error?: string): never {
  if (error) {
    console.error(`❌ ${error}`);
  }

  console.error(
    [
      "Usage:",
      "  bun run scripts/mint-agent-token.ts <agent_id> <agent_name> [--expires-in <seconds>] [--issuer <iss>] [--audience <aud>]",
      "",
      "Examples:",
      "  bun run scripts/mint-agent-token.ts agent_1 \"Nimal\"",
      "  bun run scripts/mint-agent-token.ts agent_2 \"Kasun\" --expires-in 14400",
      "",
      "Environment:",
      "  AGENT_JWT_SECRET is read from process env first, then from .env in current directory."
    ].join("\n")
  );

  process.exit(1);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

async function loadDotEnv(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }

  const result: Record<string, string> = {};
  const content = await file.text();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, value] = match;
    result[key] = stripQuotes(value);
  }

  return result;
}

function parseArgs(args: string[]): CliOptions {
  if (args.length < 2) {
    printUsageAndExit("agent_id and agent_name are required.");
  }

  const agentId = args[0]?.trim();
  const agentName = args[1]?.trim();

  if (!agentId) {
    printUsageAndExit("agent_id cannot be empty.");
  }

  if (!agentName) {
    printUsageAndExit("agent_name cannot be empty.");
  }

  let expiresInSeconds = 8 * 60 * 60;
  let issuer: string | undefined;
  let audience: string | undefined;

  let i = 2;
  while (i < args.length) {
    const flag = args[i];
    const value = args[i + 1];

    if (!flag.startsWith("--")) {
      printUsageAndExit(`Unexpected argument: ${flag}`);
    }

    if (!value) {
      printUsageAndExit(`Missing value for ${flag}`);
    }

    if (flag === "--expires-in") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        printUsageAndExit("--expires-in must be a positive integer (seconds).");
      }
      expiresInSeconds = parsed;
      i += 2;
      continue;
    }

    if (flag === "--issuer") {
      issuer = value;
      i += 2;
      continue;
    }

    if (flag === "--audience") {
      audience = value;
      i += 2;
      continue;
    }

    printUsageAndExit(`Unknown option: ${flag}`);
  }

  return {
    agentId,
    agentName,
    expiresInSeconds,
    issuer,
    audience
  };
}

function toBase64Url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesFromArrayBuffer(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

async function signHs256(input: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(input)
  );

  return toBase64Url(bytesFromArrayBuffer(signature));
}

async function resolveSecretAndDefaults(): Promise<{
  secret: string;
  issuer?: string;
  audience?: string;
}> {
  const dotEnv = await loadDotEnv(".env");

  const secret = (process.env.AGENT_JWT_SECRET || dotEnv.AGENT_JWT_SECRET || "").trim();
  if (!secret) {
    printUsageAndExit("AGENT_JWT_SECRET not found in environment or .env");
  }

  const issuer = (process.env.AGENT_JWT_ISSUER || dotEnv.AGENT_JWT_ISSUER || "").trim() || undefined;
  const audience = (process.env.AGENT_JWT_AUDIENCE || dotEnv.AGENT_JWT_AUDIENCE || "").trim() || undefined;

  return { secret, issuer, audience };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const resolved = await resolveSecretAndDefaults();

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "HS256",
    typ: "JWT"
  };

  const payload: Record<string, unknown> = {
    sub: options.agentId,
    agent_id: options.agentId,
    agent_name: options.agentName,
    iat: now,
    exp: now + options.expiresInSeconds
  };

  const issuer = options.issuer || resolved.issuer;
  const audience = options.audience || resolved.audience;

  if (issuer) payload.iss = issuer;
  if (audience) payload.aud = audience;

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await signHs256(signingInput, resolved.secret);

  const token = `${signingInput}.${signature}`;
  console.log(token);
}

void main();
