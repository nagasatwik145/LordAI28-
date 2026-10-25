import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  query: {} as Record<string, ReturnType<typeof vi.fn>>,
  from: vi.fn(),
}));

vi.hoisted(() => {
  const query = mocked.query;
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.then = vi.fn((resolve: (value: unknown) => unknown) =>
    Promise.resolve(mocked.result).then(resolve),
  );
  mocked.from.mockReturnValue(query);
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocked.from },
}));

import { fetchProjects } from "./projects";

describe("project list loading", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a real empty list for a successful empty query", async () => {
    mocked.result = { data: [], error: null };

    await expect(fetchProjects("user-1")).resolves.toEqual([]);
    expect(mocked.from).toHaveBeenCalledWith("projects");
    expect(mocked.query.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("rejects database failures so the UI does not mistake them for an empty list", async () => {
    const databaseError = { code: "42501", message: "Project read denied." };
    mocked.result = { data: null, error: databaseError };

    await expect(fetchProjects("user-1")).rejects.toBe(databaseError);
  });
});
