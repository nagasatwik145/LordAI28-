import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GUEST_SESSION_COOKIE_NAME,
  buildGuestSessionCookieHeader,
  createGuestSessionRecord,
  readGuestSessionFromRequest,
  verifyGuestCookieValue,
} from "./guest-session";
import { getRequestAuthContext } from "@/integrations/supabase/auth-middleware";

describe("guest session signing", () => {
  const previousSecret = process.env.GUEST_SESSION_SECRET;
  beforeAll(() => {
    process.env.GUEST_SESSION_SECRET = "abcdefghijklmnopqrstuvwxyz1234567890abcd";
  });

  afterAll(() => {
    if (previousSecret === undefined) {
      delete process.env.GUEST_SESSION_SECRET;
    } else {
      process.env.GUEST_SESSION_SECRET = previousSecret;
    }
  });

  it("creates and validates a signed 10-minute session", async () => {
    const record = await createGuestSessionRecord();
    const header = await buildGuestSessionCookieHeader(
      record.sessionId,
      record.expiresAt,
      "https://app.example/chat",
      record.createdAt,
    );
    const value = header.split("=")[1].split(";")[0];

    await expect(verifyGuestCookieValue(value)).resolves.toMatchObject({
      sessionId: record.sessionId,
      expiresAt: record.expiresAt,
    });
  });

  it("requires a server-side secret before signing a guest cookie", async () => {
    const previousSecret = process.env.GUEST_SESSION_SECRET;
    delete process.env.GUEST_SESSION_SECRET;
    try {
      await expect(
        buildGuestSessionCookieHeader(
          crypto.randomUUID(),
          Date.now() + 600000,
          "https://app.example/chat",
        ),
      ).rejects.toThrow("Missing required server-side GUEST_SESSION_SECRET environment variable.");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.GUEST_SESSION_SECRET;
      } else {
        process.env.GUEST_SESSION_SECRET = previousSecret;
      }
    }
  });

  it("rejects forged cookie values", async () => {
    await expect(verifyGuestCookieValue("invalid.signature")).resolves.toBeNull();
  });

  it("sets an HttpOnly same-site cookie with secure transport on HTTPS", async () => {
    const issuedAt = Date.now();
    const cookie = await buildGuestSessionCookieHeader(
      crypto.randomUUID(),
      issuedAt + 10 * 60 * 1000,
      "https://app.example/chat",
      issuedAt,
    );
    expect(cookie).toContain("; HttpOnly; SameSite=Lax;");
    expect(cookie).toMatch(/; Max-Age=(?:59[0-9]|600); Secure$/);
  });

  it("rejects invalid session IDs and expired signed sessions", async () => {
    const now = Date.now();
    await expect(
      buildGuestSessionCookieHeader("session-123", now + 10 * 60 * 1000, "http://app.example"),
    ).rejects.toThrow("Guest session ID must be a UUID.");

    const issuedAt = now - 10 * 60 * 1000 - 1000;
    const expiredCookie = await buildGuestSessionCookieHeader(
      crypto.randomUUID(),
      issuedAt + 10 * 60 * 1000,
      "http://app.example",
      issuedAt,
    );
    await expect(
      verifyGuestCookieValue(expiredCookie.split("=")[1].split(";")[0]),
    ).resolves.toBeNull();
  });

  it("rejects sessions issued in the future", async () => {
    const issuedAt = Date.now() + 60_000;
    const header = await buildGuestSessionCookieHeader(
      crypto.randomUUID(),
      issuedAt + 10 * 60 * 1000,
      "https://app.example/chat",
      issuedAt,
    );
    await expect(verifyGuestCookieValue(header.split("=")[1].split(";")[0])).resolves.toBeNull();
  });

  it("rejects malformed and oversized cookie headers", async () => {
    const malformed = new Request("https://app.example/api/chat", {
      headers: { cookie: `${GUEST_SESSION_COOKIE_NAME}=%ZZ` },
    });
    const oversized = new Request("https://app.example/api/chat", {
      headers: { cookie: `${GUEST_SESSION_COOKIE_NAME}=${"a".repeat(8200)}` },
    });
    await expect(readGuestSessionFromRequest(malformed)).resolves.toBeNull();
    await expect(readGuestSessionFromRequest(oversized)).resolves.toBeNull();
  });

  it("accepts signed guest cookies on allowlisted paths and rejects restricted ones", async () => {
    const previousSecret = process.env.GUEST_SESSION_SECRET;
    process.env.GUEST_SESSION_SECRET = "abcdefghijklmnopqrstuvwxyz1234567890abcd";

    try {
      const record = await createGuestSessionRecord();
      const header = await buildGuestSessionCookieHeader(
        record.sessionId,
        record.expiresAt,
        "https://app.example/api/chat",
        record.createdAt,
      );
      const value = header.split("=")[1].split(";")[0];

      const allowlistedRequest = new Request("https://app.example/api/chat", {
        headers: { cookie: `${GUEST_SESSION_COOKIE_NAME}=${value}` },
      });
      await expect(getRequestAuthContext(allowlistedRequest)).resolves.toMatchObject({
        guest: true,
        userId: `guest:${record.sessionId}`,
      });

      const restrictedRequest = new Request("https://app.example/api/memory", {
        headers: { cookie: `${GUEST_SESSION_COOKIE_NAME}=${value}` },
      });
      await expect(getRequestAuthContext(restrictedRequest)).rejects.toThrow(
        "Guest access is restricted to chat and voice endpoints.",
      );
    } finally {
      if (previousSecret === undefined) {
        delete process.env.GUEST_SESSION_SECRET;
      } else {
        process.env.GUEST_SESSION_SECRET = previousSecret;
      }
    }
  });
});
