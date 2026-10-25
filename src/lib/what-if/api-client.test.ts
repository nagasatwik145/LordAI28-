import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock("@/lib/authenticated-fetch", () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { requestWhatIf } from "./api-client";

const ResponseSchema = z.object({ ok: z.boolean() });

describe("What-If API client", () => {
  afterEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it("uses the authenticated request helper and parses a valid response", async () => {
    authenticatedFetchMock.mockResolvedValue(Response.json({ ok: true }));

    await expect(requestWhatIf(ResponseSchema)).resolves.toEqual({ ok: true });
    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      "/api/what-if",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("surfaces the server sign-in error instead of treating it as an empty list", async () => {
    authenticatedFetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "AI_AUTH_ERROR", message: "Sign in to use this feature." } },
        { status: 401 },
      ),
    );

    await expect(requestWhatIf(ResponseSchema)).rejects.toThrow("Sign in to use this feature.");
  });

  it("rejects an invalid success response", async () => {
    authenticatedFetchMock.mockResolvedValue(Response.json({ unexpected: true }));

    await expect(requestWhatIf(ResponseSchema)).rejects.toThrow(
      "What-If Lab returned an invalid response.",
    );
  });
});
