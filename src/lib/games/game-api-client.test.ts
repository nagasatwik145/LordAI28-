import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authenticated-fetch", () => ({ authenticatedFetch: authenticatedFetchMock }));

import { requestGamesApi, SingleFlightGate } from "./game-api-client";

describe("game API errors", () => {
  beforeEach(() => authenticatedFetchMock.mockReset());

  it("tells the user to sign in again after an unauthorized response", async () => {
    authenticatedFetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "AI_AUTH_ERROR", message: "Sign in required." } },
        { status: 401 },
      ),
    );

    await expect(requestGamesApi({ action: "generate" })).rejects.toThrow(/sign-in expired/i);
  });

  it("shows an actionable database error", async () => {
    authenticatedFetchMock.mockResolvedValue(
      Response.json({ error: { code: "DB_ERROR", message: "Could not save." } }, { status: 500 }),
    );

    await expect(requestGamesApi({ action: "save" })).rejects.toThrow(/could not be saved/i);
  });

  it("surfaces a safe AI generation failure without inventing a game", async () => {
    authenticatedFetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "AI_GENERATION_FAILED", message: "Game generation failed. Retry." } },
        { status: 502 },
      ),
    );

    await expect(requestGamesApi({ action: "generate" })).rejects.toThrow(/generation failed/i);
  });

  it("surfaces server-enforced Pro restrictions for 3D games", async () => {
    authenticatedFetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "PRO_REQUIRED", message: "LORD Pro is required for 3D games." } },
        { status: 403 },
      ),
    );

    await expect(requestGamesApi({ action: "generate", dimension: "3d" })).rejects.toThrow(
      /Pro is required/i,
    );
  });

  it("gives actionable guidance for provider rate limits and timeouts", async () => {
    authenticatedFetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "AI_RATE_LIMITED" } }, { status: 429 }),
    );
    await expect(requestGamesApi({ action: "generate" })).rejects.toThrow(/busy.*minute/i);
    authenticatedFetchMock.mockResolvedValueOnce(
      Response.json({ error: { code: "AI_TIMEOUT" } }, { status: 504 }),
    );
    await expect(requestGamesApi({ action: "generate" })).rejects.toThrow(/took too long/i);
  });
});

describe("duplicate generation submissions", () => {
  it("runs only one concurrent task", async () => {
    const gate = new SingleFlightGate();
    let finish!: (value: string) => void;
    const task = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const first = gate.run(task);
    const duplicate = gate.run(task);
    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(task).toHaveBeenCalledTimes(1);
    finish("created");
    await expect(first).resolves.toBe("created");
    expect(gate.run(async () => "next")).not.toBeNull();
  });
});
