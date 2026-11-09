import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GUEST_SESSION_COOKIE_NAME,
  buildGuestSessionCookieHeader,
  createGuestSessionRecord,
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
        buildGuestSessionCookieHeader("session-123", Date.now() + 600000, "https://app.example/chat"),
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
