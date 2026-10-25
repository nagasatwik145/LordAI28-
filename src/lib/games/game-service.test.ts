import { describe, expect, it } from "vitest";
import {
  createGameRecord,
  filterGamesForEntitlement,
  hasThreeDimensionalGameSpec,
  isThreeDimensionalGameSpec,
  ownedGamesQuery,
  requiresGameProAccess,
  scopeGameToOwner,
  updateGameGeneration,
  type PersistedGame,
} from "./game-service";
function fakeDb(result: { data: PersistedGame | null; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const query = {
    from: (table: string) => {
      calls.push(["from", table]);
      return query;
    },
    select: (columns: string) => {
      calls.push(["select", columns]);
      return query;
    },
    eq: (column: string, value: string) => {
      calls.push(["eq", column, value]);
      return query;
    },
    insert: (values: Record<string, unknown>) => {
      calls.push(["insert", values]);
      return query;
    },
    update: (values: Record<string, unknown>) => {
      calls.push(["update", values]);
      return query;
    },
    delete: (options: { count: "exact" }) => {
      calls.push(["delete", options]);
      return query;
    },
    order: (column: string, options: { ascending: boolean }) => {
      calls.push(["order", column, options]);
      return query;
    },
    limit: async (count: number) => {
      calls.push(["limit", count]);
      return { data: [], error: null };
    },
    maybeSingle: async () => result,
    single: async () => result,
  };
  return { db: query, calls };
}

describe("Create Apka Jalwa persistence", () => {
  it("detects 3D specs in both current and saved-version payloads", () => {
    expect(isThreeDimensionalGameSpec({ schemaVersion: 3 })).toBe(true);
    expect(isThreeDimensionalGameSpec({ dimension: "3d" })).toBe(true);
    expect(isThreeDimensionalGameSpec({ schemaVersion: 2 })).toBe(false);
    expect(isThreeDimensionalGameSpec(null)).toBe(false);
    expect(hasThreeDimensionalGameSpec([{ schemaVersion: 2 }, { schemaVersion: 3 }])).toBe(true);
    expect(hasThreeDimensionalGameSpec([{ schemaVersion: 2 }])).toBe(false);
  });

  it("requires Pro for 3D game content in current specs and version history", () => {
    expect(requiresGameProAccess({ spec: { schemaVersion: 3 }, versions: [] })).toBe(true);
    expect(requiresGameProAccess({ spec: { schemaVersion: 2 }, versions: [{ dimension: "3d" }] })).toBe(
      true,
    );
    expect(requiresGameProAccess({ spec: { schemaVersion: 2 }, versions: [] })).toBe(false);
  });

  it("hides saved 3D content from users without Pro without hiding their 2D games", () => {
    const games = [
      { id: "2d", spec: { schemaVersion: 2 }, versions: [] },
      { id: "3d", spec: { schemaVersion: 3 }, versions: [] },
    ];

    expect(filterGamesForEntitlement(games, false).map(({ id }) => id)).toEqual(["2d"]);
    expect(filterGamesForEntitlement(games, true)).toEqual(games);
  });

  it("creates an owned pending record before generation and returns its ID", async () => {
    const savedRecord: PersistedGame = {
      id: "game-123",
      spec: null,
      prompt: "A neon runner in Mumbai",
      versions: [],
      status: "pending",
      created_at: "2026-10-20T00:00:00.000Z",
      updated_at: "2026-10-20T00:00:00.000Z",
    };
    const { db, calls } = fakeDb({ data: savedRecord, error: null });

    const game = await createGameRecord(db, {
      userId: "user-abc",
      prompt: "A neon runner in Mumbai",
    });

    expect(game).toEqual(savedRecord);
    expect(calls.find(([method]) => method === "insert")?.[1]).toEqual({
      user_id: "user-abc",
      spec: null,
      prompt: "A neon runner in Mumbai",
      versions: [],
      status: "pending",
    });
  });

  it("rejects unauthenticated creation before calling generation or the database", async () => {
    const { db, calls } = fakeDb({ data: null, error: null });
    await expect(
      createGameRecord(db, {
        userId: "",
        prompt: "A real game idea",
      }),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(calls).toEqual([]);
  });

  it("persists the ready transition for its owner", async () => {
    const { db, calls } = fakeDb({
      data: {
        id: "game-123",
        spec: null,
        prompt: "A neon runner",
        versions: [],
        status: "ready",
        created_at: "2026-10-20T00:00:00.000Z",
        updated_at: "2026-10-20T00:00:00.000Z",
      },
      error: null,
    });
    const game = await updateGameGeneration(db, "user-abc", "game-123", {
      status: "ready",
      spec: null,
    });
    expect(game.status).toBe("ready");
    expect(calls).toContainEqual(["update", { status: "ready", spec: null }]);
    expect(calls).toContainEqual(["eq", "user_id", "user-abc"]);
    expect(calls).toContainEqual(["eq", "id", "game-123"]);
  });

  it("restricts saved-game reads to the authenticated owner", async () => {
    const { db, calls } = fakeDb({ data: null, error: null });

    ownedGamesQuery(db, "owner-123");

    expect(calls).toContainEqual(["from", "ai_games"]);
    expect(calls).toContainEqual(["eq", "user_id", "owner-123"]);
  });

  it("restricts edits and deletes to the authenticated owner and requested game", () => {
    const calls: Array<[string, string]> = [];
    const makeQuery = () => {
      const query = {
        eq(column: string, value: string) {
          calls.push([column, value]);
          return query;
        },
      };
      return query;
    };

    scopeGameToOwner(makeQuery(), "owner-123", "game-456");
    scopeGameToOwner(makeQuery(), "owner-123", "game-789");

    expect(calls).toEqual([
      ["user_id", "owner-123"],
      ["id", "game-456"],
      ["user_id", "owner-123"],
      ["id", "game-789"],
    ]);
  });

  it("does not return success when record persistence fails", async () => {
    const databaseFailure = { code: "42501", message: "RLS denied" };
    const { db } = fakeDb({ data: null, error: databaseFailure });

    await expect(
      createGameRecord(db, {
        userId: "user-abc",
        prompt: "A real game idea",
      }),
    ).rejects.toMatchObject({ kind: "database", cause: databaseFailure });
  });
});
