import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { getUser, getSession } })),
}));

import { getAuthenticatedSupabase } from "./auth-middleware";

describe("Supabase request auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  });

  it("rejects invalid bearer tokens before request processing", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") });

    await expect(
      getAuthenticatedSupabase(
        new Request("https://app.example/api/test", {
          headers: { Authorization: "Bearer invalid-token" },
        }),
      ),
    ).rejects.toThrow("Unauthorized: Invalid token");
  });

  it("rejects requests that lack a valid session", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(
      getAuthenticatedSupabase(new Request("https://app.example/api/test")),
    ).rejects.toThrow("Unauthorized: Invalid session");
  });
});
