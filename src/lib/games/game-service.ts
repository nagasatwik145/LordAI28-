import type { StoredGameSpec } from "./game-runtime";

const GAME_COLUMNS = "id,spec,prompt,versions,status,idempotency_key,created_at,updated_at";

export type PersistedGame = {
  id: string;
  spec: StoredGameSpec | null;
  prompt: string;
  versions: StoredGameSpec[];
  status: "pending" | "generating" | "ready" | "failed";
  idempotency_key?: string | null;
  created_at: string;
  updated_at: string;
};

export function isThreeDimensionalGameSpec(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const spec = value as { dimension?: unknown; schemaVersion?: unknown };
  return spec.dimension === "3d" || spec.schemaVersion === 3;
}

export function hasThreeDimensionalGameSpec(values: readonly unknown[]): boolean {
  return values.some(isThreeDimensionalGameSpec);
}

export function requiresGameProAccess(game: {
  spec: unknown;
  versions?: readonly unknown[];
}): boolean {
  return isThreeDimensionalGameSpec(game.spec) || hasThreeDimensionalGameSpec(game.versions ?? []);
}

export function filterGamesForEntitlement<
  T extends { spec: unknown; versions: readonly unknown[] },
>(games: readonly T[], hasPro: boolean): T[] {
  return hasPro ? [...games] : games.filter((game) => !requiresGameProAccess(game));
}

export type GameRecordQuery = {
  select(columns: string): GameRecordQuery;
  eq(column: string, value: string): GameRecordQuery;
  insert(values: Record<string, unknown>): GameRecordQuery;
  update(values: Record<string, unknown>): GameRecordQuery;
  single(): Promise<{ data: PersistedGame | null; error: unknown }>;
  maybeSingle(): Promise<{ data: PersistedGame | null; error: unknown }>;
  order(column: string, options: { ascending: boolean }): GameRecordQuery;
  limit(count: number): Promise<{ data: PersistedGame[] | null; error: unknown }>;
};
export type GameDatabase = { from(table: "ai_games"): GameRecordQuery };

export class GameServiceError extends Error {
  constructor(
    readonly kind:
      | "auth"
      | "generation"
      | "not_configured"
      | "database"
      | "rate_limited"
      | "model_unavailable"
      | "timeout"
      | "unsupported",
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "GameServiceError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function ownedGamesQuery(db: GameDatabase, userId: string) {
  return db.from("ai_games").select(GAME_COLUMNS).eq("user_id", userId);
}

export function scopeGameToOwner<Query extends { eq(column: string, value: string): Query }>(
  query: Query,
  userId: string,
  gameId?: string,
): Query {
  const ownerQuery = query.eq("user_id", userId);
  return gameId ? ownerQuery.eq("id", gameId) : ownerQuery;
}

export async function createGameRecord(
  db: GameDatabase,
  input: {
    userId: string;
    prompt: string;
    idempotencyKey?: string;
  },
) {
  if (!input.userId) throw new GameServiceError("auth", "Sign in to create a game.");

  try {
    if (
      input.idempotencyKey &&
      (input.idempotencyKey.length > 200 || !/^[a-zA-Z0-9:_-]+$/.test(input.idempotencyKey))
    ) {
      throw new GameServiceError("unsupported", "The game idempotency key is invalid.");
    }

    if (input.idempotencyKey) {
      const { data: existing, error: lookupError } = await db
        .from("ai_games")
        .select(GAME_COLUMNS)
        .eq("user_id", input.userId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (lookupError)
        throw new GameServiceError("database", "The game record could not be loaded.", lookupError);
      if (existing) return existing;
    }

    const values: Record<string, unknown> = {
      user_id: input.userId,
      spec: null,
      prompt: input.prompt,
      versions: [],
      status: "pending",
    };
    if (input.idempotencyKey) values.idempotency_key = input.idempotencyKey;
    const { data, error } = await db.from("ai_games").insert(values).select(GAME_COLUMNS).single();
    if (error || !data?.id) {
      if (input.idempotencyKey) {
        const { data: existing, error: lookupError } = await db
          .from("ai_games")
          .select(GAME_COLUMNS)
          .eq("user_id", input.userId)
          .eq("idempotency_key", input.idempotencyKey)
          .maybeSingle();
        if (!lookupError && existing) return existing;
      }
      throw new GameServiceError("database", "The game record could not be created.", error);
    }
    return data;
  } catch (error) {
    if (error instanceof GameServiceError) throw error;
    throw new GameServiceError("database", "The game record could not be created.", error);
  }
}

export async function updateGameGeneration(
  db: GameDatabase,
  userId: string,
  gameId: string,
  values: { status: PersistedGame["status"]; spec?: StoredGameSpec | null },
) {
  const { data, error } = await db
    .from("ai_games")
    .update(values)
    .eq("user_id", userId)
    .eq("id", gameId)
    .select(GAME_COLUMNS)
    .single();
  if (error || !data)
    throw new GameServiceError("database", "The game status could not be saved.", error);
  return data;
}
