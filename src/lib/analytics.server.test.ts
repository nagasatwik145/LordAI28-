import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  inserted: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "analytics_consents")
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { enabled: mocks.enabled } }) }),
          }),
        };
      return { insert: mocks.inserted };
    },
  },
}));

import { isGrowthAdmin, recordProductEvent } from "./analytics.server";

describe("privacy-conscious analytics", () => {
  beforeEach(() => {
    mocks.enabled = false;
    mocks.inserted.mockReset().mockResolvedValue({ error: null });
    process.env.LORD_ADMIN_USER_IDS = "admin-uuid, second-admin";
  });

  it("requires explicit consent and stores minimized event properties only", async () => {
    await recordProductEvent("user-uuid", { event: "chat_succeeded", feature: "chat" });
    expect(mocks.inserted).not.toHaveBeenCalled();

    mocks.enabled = true;
    await recordProductEvent("user-uuid", { event: "chat_succeeded", feature: "chat" });
    expect(mocks.inserted).toHaveBeenCalledWith({
      user_id: "user-uuid",
      event_name: "chat_succeeded",
      schema_version: 1,
      dedupe_key: undefined,
      feature: "chat",
      category: undefined,
      duration_ms: undefined,
    });
  });

  it("authorizes only exact server allowlisted user UUIDs", () => {
    expect(isGrowthAdmin("admin-uuid")).toBe(true);
    expect(isGrowthAdmin("admin-uuid-extra")).toBe(false);
    expect(isGrowthAdmin("ordinary-user")).toBe(false);
  });

  it("treats a deduplicated provider retry as already recorded", async () => {
    mocks.enabled = true;
    mocks.inserted.mockResolvedValue({ error: { code: "23505" } });
    await expect(
      recordProductEvent("user-uuid", {
        event: "subscription_checkout_confirmed",
        dedupeKey: "razorpay:payment-id",
      }),
    ).resolves.toBeUndefined();
  });
});
