import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}));

vi.mock("@/lib/authenticated-fetch", () => ({
  authenticatedFetch: authenticatedFetchMock,
}));

import { loadStudioJson } from "./anything-studio-client";

const StudioListSchema = z.object({ projects: z.array(z.string()) });

describe("Anything Studio loading requests", () => {
  afterEach(() => {
    authenticatedFetchMock.mockReset();
  });

  it("parses successful saved-project responses", async () => {
    authenticatedFetchMock.mockResolvedValue(Response.json({ projects: ["project-1"] }));

    await expect(loadStudioJson("/api/anything-studio", StudioListSchema)).resolves.toEqual({
      projects: ["project-1"],
    });
  });

  it("surfaces server errors and rejects malformed success responses", async () => {
    authenticatedFetchMock.mockResolvedValueOnce(
      Response.json({ error: { message: "Project query failed." } }, { status: 500 }),
    );
    await expect(loadStudioJson("/api/anything-studio", StudioListSchema)).rejects.toThrow(
      "Project query failed.",
    );

    authenticatedFetchMock.mockResolvedValueOnce(Response.json({ projects: "invalid" }));
    await expect(loadStudioJson("/api/anything-studio", StudioListSchema)).rejects.toThrow(
      "LORD returned invalid Studio data.",
    );
  });

  it("aborts a request that stalls past its deadline", async () => {
    authenticatedFetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Request aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    await expect(
      loadStudioJson("/api/anything-studio", StudioListSchema, undefined, 10),
    ).rejects.toThrow("Studio request timed out. Please retry.");
  });
});
