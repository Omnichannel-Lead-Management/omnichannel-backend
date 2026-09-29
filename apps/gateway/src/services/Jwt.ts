/**
 * HS256 token primitives shared by the two independent session systems on this
 * gateway: business-owner sessions (SessionAuth) and platform-admin sessions
 * (AdminAuth).
 *
 * Each system passes its own secret and its own issuer. Pinning the issuer is
 * what stops a business token from ever being accepted as an admin token, even
 * if both were somehow signed with the same secret.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(segment: string): Uint8Array<ArrayBuffer> {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const buffer = Buffer.from(padded, "base64");
  // Copied into a plain ArrayBuffer: Buffer's own is pooled and shared, which
  // crypto.subtle's BufferSource type rightly refuses.
  const bytes = new Uint8Array(new ArrayBuffer(buffer.byteLength));
  bytes.set(buffer);
  return bytes;
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Constant-time comparison. Token and secret comparisons must not leak length
 * or prefix information through early returns.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

/** Caches the imported CryptoKey so every call does not re-import the secret. */
export class HmacSigner {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private readonly secret: string) {}

  private async getKey(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
      );
    }
    return await this.keyPromise;
  }

  /** Signs `{claims, iat, exp, iss}` and returns the compact token. */
  async sign(
    claims: Record<string, unknown>,
    options: { issuer: string; ttlSeconds: number }
  ): Promise<{ token: string; expires_at: string }> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + options.ttlSeconds;

    const header = encodeJson({ alg: "HS256", typ: "JWT" });
    const payload = encodeJson({ ...claims, iat: issuedAt, exp: expiresAt, iss: options.issuer });

    const signingInput = `${header}.${payload}`;
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.getKey(),
      new TextEncoder().encode(signingInput)
    );

    return {
      token: `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`,
      expires_at: new Date(expiresAt * 1000).toISOString()
    };
  }

  /**
   * Returns the claims of a valid, unexpired token issued by `issuer`, or null.
   * Never throws, whatever the caller sends.
   */
  async verify(token: string, issuer: string): Promise<Record<string, unknown> | null> {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
      claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    } catch {
      return null;
    }

    // Pinning the algorithm rejects "alg": "none" and RS/HS confusion attempts.
    if (header.alg !== "HS256") return null;

    let valid = false;
    try {
      valid = await crypto.subtle.verify(
        "HMAC",
        await this.getKey(),
        base64UrlDecode(signaturePart),
        new TextEncoder().encode(`${headerPart}.${payloadPart}`)
      );
    } catch {
      return null;
    }
    if (!valid) return null;

    if (claims.iss !== issuer) return null;

    const exp = typeof claims.exp === "number" ? claims.exp : 0;
    if (Math.floor(Date.now() / 1000) >= exp) return null;

    return claims;
  }
}

/** Reads a positive TTL in hours from the environment, falling back to a default. */
export function ttlSecondsFromEnv(raw: string | undefined, defaultHours: number): number {
  const hours = Number(raw ?? defaultHours);
  return Number.isFinite(hours) && hours > 0
    ? Math.floor(hours * 3600)
    : defaultHours * 3600;
}
