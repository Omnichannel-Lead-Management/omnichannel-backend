type AgentAuthMode = "none" | "static" | "jwt";

export interface AgentAuthIdentity {
  agent_id?: string;
  agent_name?: string;
  business_id?: string;
  claims?: Record<string, unknown>;
}

export interface AgentAuthResult {
  success: boolean;
  error?: string;
  identity?: AgentAuthIdentity;
}

function parseMode(raw: string | undefined): AgentAuthMode {
  const value = (raw || "none").trim().toLowerCase();

  if (value === "static" || value === "jwt") {
    return value;
  }

  return "none";
}

function decodeJwtSegment(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodeJwtBytes(segment: string): Uint8Array {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function readOptionalClaim(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed || undefined;
}

function readNumericClaim(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

export class AgentAuthService {
  private mode: AgentAuthMode;
  private staticTokens: Map<string, string | undefined>;
  private jwtSecret: string;
  private jwtIssuer: string | null;
  private jwtAudience: string | null;
  private jwtKeyPromise: Promise<CryptoKey> | null = null;

  constructor() {
    this.mode = parseMode(process.env.AGENT_AUTH_MODE);

    this.staticTokens = new Map(
      (process.env.AGENT_AUTH_TOKENS || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const separatorIndex = entry.indexOf(":");
          if (separatorIndex === -1) return [entry, undefined] as const;
          const token = entry.slice(0, separatorIndex).trim();
          const businessId = entry.slice(separatorIndex + 1).trim() || undefined;
          return [token, businessId] as const;
        })
    );

    this.jwtSecret = process.env.AGENT_JWT_SECRET || "";
    this.jwtIssuer = process.env.AGENT_JWT_ISSUER?.trim() || null;
    this.jwtAudience = process.env.AGENT_JWT_AUDIENCE?.trim() || null;

    if (this.mode === "none") {
      console.log("ℹ️  Agent auth mode is disabled (AGENT_AUTH_MODE=none)");
      return;
    }

    if (this.mode === "static") {
      if (this.staticTokens.size === 0) {
        console.warn("⚠️  AGENT_AUTH_MODE=static but AGENT_AUTH_TOKENS is empty");
      } else {
        console.log(`🔐 Agent auth enabled (static tokens: ${this.staticTokens.size})`);
      }
      return;
    }

    if (!this.jwtSecret) {
      console.warn("⚠️  AGENT_AUTH_MODE=jwt but AGENT_JWT_SECRET is empty");
    } else {
      console.log("🔐 Agent auth enabled (JWT mode)");
    }
  }

  async authenticate(token?: string): Promise<AgentAuthResult> {
    if (this.mode === "none") {
      return { success: true };
    }

    const providedToken = token?.trim();
    if (!providedToken) {
      return {
        success: false,
        error: "Authentication token is required."
      };
    }

    if (this.mode === "static") {
      return this.authenticateStatic(providedToken);
    }

    return await this.authenticateJwt(providedToken);
  }

  private authenticateStatic(token: string): AgentAuthResult {
    if (this.staticTokens.size === 0) {
      return {
        success: false,
        error: "Agent static token authentication is not configured."
      };
    }

    if (!this.staticTokens.has(token)) {
      return {
        success: false,
        error: "Invalid agent token."
      };
    }

    return { success: true, identity: { business_id: this.staticTokens.get(token) } };
  }

  private async authenticateJwt(token: string): Promise<AgentAuthResult> {
    if (!this.jwtSecret) {
      return {
        success: false,
        error: "Agent JWT authentication is not configured."
      };
    }

    try {
      const payload = await this.verifyJwt(token);

      const identity: AgentAuthIdentity = {
        agent_id:
          readOptionalClaim(payload, "agent_id") ||
          readOptionalClaim(payload, "sub") ||
          readOptionalClaim(payload, "preferred_username"),
        agent_name:
          readOptionalClaim(payload, "agent_name") ||
          readOptionalClaim(payload, "name"),
        business_id: readOptionalClaim(payload, "business_id"),
        claims: payload
      };

      return {
        success: true,
        identity
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Invalid JWT token."
      };
    }
  }

  private async verifyJwt(token: string): Promise<Record<string, unknown>> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format.");
    }

    const [headerPart, payloadPart, signaturePart] = parts;

    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;

    try {
      header = JSON.parse(decodeJwtSegment(headerPart)) as Record<string, unknown>;
      payload = JSON.parse(decodeJwtSegment(payloadPart)) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid JWT payload encoding.");
    }

    if (header.alg !== "HS256") {
      throw new Error("Unsupported JWT algorithm. Expected HS256.");
    }

    const signingInput = `${headerPart}.${payloadPart}`;
    const signatureBytes = decodeJwtBytes(signaturePart);

    const key = await this.getJwtKey();
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      toArrayBuffer(signatureBytes),
      new TextEncoder().encode(signingInput)
    );

    if (!isValid) {
      throw new Error("Invalid JWT signature.");
    }

    this.validateTimeClaims(payload);
    this.validateIssuerAndAudience(payload);

    return payload;
  }

  private async getJwtKey(): Promise<CryptoKey> {
    if (!this.jwtKeyPromise) {
      this.jwtKeyPromise = crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.jwtSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      );
    }

    return await this.jwtKeyPromise;
  }

  private validateTimeClaims(payload: Record<string, unknown>): void {
    const now = Math.floor(Date.now() / 1000);
    const exp = readNumericClaim(payload, "exp");
    const nbf = readNumericClaim(payload, "nbf");

    if (typeof exp === "number" && now >= exp) {
      throw new Error("JWT has expired.");
    }

    if (typeof nbf === "number" && now < nbf) {
      throw new Error("JWT is not active yet.");
    }
  }

  private validateIssuerAndAudience(payload: Record<string, unknown>): void {
    if (this.jwtIssuer) {
      const tokenIssuer = readOptionalClaim(payload, "iss");
      if (tokenIssuer !== this.jwtIssuer) {
        throw new Error("JWT issuer is invalid.");
      }
    }

    if (this.jwtAudience) {
      const tokenAudience = payload.aud;

      if (typeof tokenAudience === "string") {
        if (tokenAudience !== this.jwtAudience) {
          throw new Error("JWT audience is invalid.");
        }
        return;
      }

      if (Array.isArray(tokenAudience)) {
        const hasAudience = tokenAudience.some(
          (entry) => typeof entry === "string" && entry === this.jwtAudience
        );
        if (!hasAudience) {
          throw new Error("JWT audience is invalid.");
        }
        return;
      }

      throw new Error("JWT audience is invalid.");
    }
  }
}

export const agentAuthService = new AgentAuthService();
