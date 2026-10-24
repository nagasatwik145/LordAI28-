import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasConfiguredLifetimeIdentity,
  hasProEntitlement,
  isEntitlementActive,
} from "./entitlements.server";

const supabaseAdmin = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin,
}));

const identities = {
  "nagasatwik145@gmail.com": "11111111-1111-4111-8111-111111111111",
  "djahnavi451@gmail.com": "22222222-2222-4222-8222-222222222222",
  "inf1nity3smart@gmail.com": "33333333-3333-4333-8333-333333333333",
};

describe("Pro entitlements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects expired subscriptions and locks expired Pro access", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { status: "active", expires_at: past },
      error: null,
    });
    supabaseAdmin.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => ({ error: null }),
        }),
      }),
    }));

    const result = await hasProEntitlement({
      id: "user-1",
      email: "member@example.com",
      email_confirmed_at: "2026-01-01T00:00:00Z",
    });

    expect(result).toBe(false);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("requires verified email and an immutable matching user ID for each lifetime grant", () => {
    for (const [email, id] of Object.entries(identities)) {
      process.env.LORD_LIFETIME_PRO_USERS = `${id}:${email}`;
      expect(
        hasConfiguredLifetimeIdentity({ id, email, email_confirmed_at: "2026-01-01T00:00:00Z" }),
      ).toBe(true);
      expect(
        hasConfiguredLifetimeIdentity({
          id: "99999999-9999-4999-8999-999999999999",
          email,
          email_confirmed_at: "2026-01-01T00:00:00Z",
        }),
      ).toBe(false);
      expect(hasConfiguredLifetimeIdentity({ id, email, email_confirmed_at: null })).toBe(false);
      expect(
        hasConfiguredLifetimeIdentity({
          id,
          email: "attacker@example.com",
          email_confirmed_at: "2026-01-01T00:00:00Z",
        }),
      ).toBe(false);
    }
  });

  it("keeps free and expired accounts locked, and active or unexpired cancelled Pro active", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isEntitlementActive("inactive", null)).toBe(false);
    expect(isEntitlementActive("active", past)).toBe(false);
    expect(isEntitlementActive("active", future)).toBe(true);
    expect(isEntitlementActive("cancelled", future)).toBe(true);
    expect(isEntitlementActive("cancelled", null)).toBe(false);
  });
});
