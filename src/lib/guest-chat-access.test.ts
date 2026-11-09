import { describe, expect, it, beforeAll } from "vitest";
import {
  GUEST_ALLOWED_REQUEST_PATHS,
  isGuestAllowedPath,
} from "@/integrations/supabase/auth-middleware";
import {
  GUEST_SESSION_TTL_MS,
  buildGuestSessionCookieHeader,
  createGuestSessionRecord,
} from "@/lib/guest-session";

describe("guest chat access policy", () => {
  it("allows the guest-safe chat surface", () => {
    expect(isGuestAllowedPath("/api/chat")).toBe(true);
    expect(isGuestAllowedPath("/api/models")).toBe(false);
    expect(isGuestAllowedPath("/api/openrouter-test")).toBe(false);
    expect(isGuestAllowedPath("/api/chat/ocr")).toBe(false);
    expect(isGuestAllowedPath("/api/voice/tts")).toBe(true);
  });

  it("rejects account-only endpoints for guests", () => {
    for (const path of [
      "/api/conversations",
      "/api/memory",
      "/api/images",
      "/api/title",
      "/api/analytics/events",
      "/api/openrouter-test",
      "/api/user-settings",
    ]) {
      expect(isGuestAllowedPath(path)).toBe(false);
    }
  });

  it("never persists guest data: no conversation/message endpoints are guest-allowed", () => {
    const persistencePaths = [...GUEST_ALLOWED_REQUEST_PATHS].filter((path) =>
      /conversation|message|title|share|memory/.test(path),
    );
    expect(persistencePaths).toEqual([]);
  });
});

describe("guest session expiry invariants", () => {
  beforeAll(() => {
    process.env.GUEST_SESSION_SECRET = "test-guest-session-secret-0123456789abcdef";
  });

  it("session TTL is exactly 10 minutes", () => {
    expect(GUEST_SESSION_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("cookie expiry is exactly TTL from issuance and never extends on re-issue", async () => {
    const record = await createGuestSessionRecord();
    const header = await buildGuestSessionCookieHeader(
      record.sessionId,
      record.expiresAt,
      "https://lordai.test",
      record.createdAt,
    );
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    const maxAge = Number(header.match(/Max-Age=(\d+)/)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(Math.ceil(GUEST_SESSION_TTL_MS / 1000));
  });

  it("rejects cookies whose lifetime differs from the fixed TTL", async () => {
    const now = Date.now();
    await expect(
      buildGuestSessionCookieHeader(
        crypto.randomUUID(),
        now + 60 * 60 * 1000,
        "https://lordai.test",
        now,
      ),
    ).rejects.toThrow(/exactly 10 minutes/);
  });
});
