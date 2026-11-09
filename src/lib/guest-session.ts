export const GUEST_SESSION_COOKIE_NAME = "lord_guest_session";
export const GUEST_SESSION_TTL_MS = 10 * 60 * 1000;
export const GUEST_SESSION_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const GUEST_SESSION_MAX_CREATES_PER_WINDOW = 8;
const GUEST_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type GuestSessionStatus = {
  active: boolean;
  guest: boolean;
  sessionId: string;
  expiresAt: number;
  remainingMs: number;
  expired: boolean;
};

type GuestSessionRecord = {
  sessionId: string;
  expiresAt: number;
  createdAt: number;
};

// Local, best-effort throttling only. This is not a distributed authorization
// boundary and is intentionally not treated as production-grade rate limiting.
const guestSessionCreationAttempts = new Map<string, number[]>();

function getGuestSigningSecret() {
  const secret = process.env.GUEST_SESSION_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error("Missing required server-side GUEST_SESSION_SECRET environment variable.");
  }
  return secret;
}

function encodeBase64Url(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const decoded =
    typeof atob === "function"
      ? atob(normalized + padding)
      : Buffer.from(normalized + padding, "base64").toString("binary");
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

async function getGuestSigningKey() {
  const secret = getGuestSigningSecret();
  const keyMaterial = new TextEncoder().encode(secret);
  return crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function signGuestClaim(claim: Record<string, unknown>) {
  const key = await getGuestSigningKey();
  const payload = JSON.stringify(claim);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

function getClientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const cfIp = request.headers.get("cf-connecting-ip");
  const raw = forwarded?.split(",")[0] ?? realIp ?? cfIp ?? "unknown";
  return raw.trim() || "unknown";
}

export function enforceGuestSessionCreationRateLimit(
  request: Request,
  nowMs = Date.now(),
): boolean {
  // This is a soft, process-local guard only. It does not provide a distributed
  // production-grade limiter across multiple app instances or Vercel regions.
  const address = getClientAddress(request);
  const attempts = (guestSessionCreationAttempts.get(address) ?? []).filter(
    (timestamp) => nowMs - timestamp < GUEST_SESSION_RATE_LIMIT_WINDOW_MS,
  );
  if (attempts.length >= GUEST_SESSION_MAX_CREATES_PER_WINDOW) {
    guestSessionCreationAttempts.set(address, attempts);
    return false;
  }
  attempts.push(nowMs);
  guestSessionCreationAttempts.set(address, attempts);
  return true;
}

export async function createGuestSessionRecord() {
  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const expiresAt = now + GUEST_SESSION_TTL_MS;
  const record: GuestSessionRecord = {
    sessionId,
    expiresAt,
    createdAt: now,
  };
  return record;
}

export async function buildGuestSessionCookieHeader(
  sessionId: string,
  expiresAt: number,
  requestUrl: string,
  issuedAt = Date.now(),
) {
  // Fail closed on server configuration before validating/signing caller data.
  getGuestSigningSecret();
  if (!GUEST_SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("Guest session ID must be a UUID.");
  }
  const claim = {
    v: 1,
    sid: sessionId,
    iat: issuedAt,
    exp: expiresAt,
  };

  if (expiresAt - issuedAt !== GUEST_SESSION_TTL_MS) {
    throw new Error("Guest session expiry must be exactly 10 minutes from creation.");
  }

  const payload = encodeBase64Url(JSON.stringify(claim));
  const signature = await signGuestClaim(claim);
  const value = `${payload}.${signature}`;
  const secure = /^https:/i.test(requestUrl) ? "; Secure" : "";
  const maxAgeSeconds = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  return `${GUEST_SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export async function verifyGuestCookieValue(value: string) {
  if (value.length > 3800 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    const encodedClaim = parts[0];
    const providedSignature = parts[1];
    const bytes = decodeBase64Url(encodedClaim);
    const claim = JSON.parse(new TextDecoder().decode(bytes)) as {
      v?: number;
      sid?: string;
      iat?: number;
      exp?: number;
    };

    if (
      !claim ||
      claim.v !== 1 ||
      typeof claim.sid !== "string" ||
      !GUEST_SESSION_ID_PATTERN.test(claim.sid) ||
      typeof claim.iat !== "number" ||
      typeof claim.exp !== "number"
    ) {
      return null;
    }

    if (!Number.isFinite(claim.iat) || !Number.isFinite(claim.exp)) {
      return null;
    }

    if (claim.exp <= claim.iat) {
      return null;
    }

    if (claim.exp - claim.iat !== GUEST_SESSION_TTL_MS) {
      return null;
    }

    const now = Date.now();
    if (claim.iat > now || claim.exp <= now) {
      return null;
    }

    const key = await getGuestSigningKey();
    const expectedPayload = JSON.stringify({
      v: claim.v,
      sid: claim.sid,
      iat: claim.iat,
      exp: claim.exp,
    });
    const signatureBytes = decodeBase64Url(providedSignature);
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(expectedPayload),
    );
    if (!validSignature) return null;

    return {
      sessionId: claim.sid,
      expiresAt: claim.exp,
      issuedAt: claim.iat,
    };
  } catch {
    return null;
  }
}

export async function readGuestSessionFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (cookieHeader.length > 8192) return null;
  const cookieEntries = cookieHeader.split(";").map((entry) => entry.trim());
  const rawGuestCookie = cookieEntries.find((entry) =>
    entry.startsWith(`${GUEST_SESSION_COOKIE_NAME}=`),
  );
  if (!rawGuestCookie) return null;

  let value: string;
  try {
    value = decodeURIComponent(rawGuestCookie.slice(GUEST_SESSION_COOKIE_NAME.length + 1));
  } catch {
    return null;
  }
  const verified = await verifyGuestCookieValue(value);
  if (!verified) return null;

  const expiresAt = verified.expiresAt;
  if (expiresAt <= Date.now()) return null;

  const remainingMs = Math.max(0, expiresAt - Date.now());
  return {
    sessionId: verified.sessionId,
    expiresAt,
    createdAt: verified.issuedAt,
    remainingMs,
  };
}

export async function getGuestSessionStatus(request: Request): Promise<GuestSessionStatus> {
  const session = await readGuestSessionFromRequest(request);
  if (!session) {
    return {
      active: false,
      guest: false,
      sessionId: "",
      expiresAt: 0,
      remainingMs: 0,
      expired: true,
    };
  }

  const expired = session.expiresAt <= Date.now();
  return {
    active: !expired,
    guest: true,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    remainingMs: expired ? 0 : session.remainingMs,
    expired,
  };
}
