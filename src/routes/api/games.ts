/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase schema is added by this migration and generated database types are maintained separately. */
import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { upgradeLegacyGameSpec, validateGameSpec, type GeneratedGameSpec, type GameSpec, type StoredGameSpec } from "@/lib/games/game-runtime";
import {
  createGameRecord,
  filterGamesForEntitlement,
  GameServiceError,
  ownedGamesQuery,
  requiresGameProAccess,
  scopeGameToOwner,
  updateGameGeneration,
} from "@/lib/games/game-service";
import { GameRequestSchema } from "@/lib/games/game-request-schema";
import { generationFailure, upstreamStatus } from "@/lib/games/game-errors";
import { generateGameSpec } from "@/lib/games/game-generation.server";
import { hasProEntitlement } from "@/lib/billing/entitlements.server";
import { recordProductEvent } from "@/lib/analytics.server";

const DEFAULT_GAME_MODEL = "minimax/minimax-m3.1-flash:free";
const proRequiredResponse = () =>
  Response.json(
    {
      error: {
        code: "PRO_REQUIRED",
        message: "LORD Pro is required to create, modify, save, or open 3D games.",
      },
    },
    { status: 403 },
  );

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

export const Route = createFileRoute("/api/games")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const { userId, supabase, claims } = context as {
          userId: string;
          supabase: unknown;
          claims?: { email?: string; email_confirmed_at?: string | null };
        };
        const db = supabase as any;
        let action = "unknown";
        let gameId: string | undefined;
        const requestId = crypto.randomUUID();
        let proAccess: boolean | undefined;
        const checkPro = async (): Promise<boolean | Response> => {
          if (proAccess !== undefined) return proAccess;
          try {
            proAccess = await hasProEntitlement({ id: userId, ...claims });
            return proAccess;
          } catch (error) {
            console.error("[games] entitlement verification failed", {
              requestId,
              action,
              errorName: error instanceof Error ? error.name : "unknown",
            });
            return Response.json(
              {
                error: {
                  code: "PRO_CHECK_UNAVAILABLE",
                  message: "Game access could not be verified. Please retry.",
                },
              },
              { status: 503 },
            );
          }
        };
        const requirePro = async (): Promise<Response | null> => {
          const access = await checkPro();
          if (access instanceof Response) return access;
          return access ? null : proRequiredResponse();
        };
        try {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return Response.json(
              { error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } },
              { status: 400 },
            );
          }
          const input = GameRequestSchema.safeParse(body);
          if (!input.success)
            return Response.json(
              { error: { code: "INVALID_REQUEST", message: "Invalid game request." } },
              { status: 400 },
            );
          const op = input.data;
          action = op.action;
          if (op.action === "generate") {
            if (op.dimension === "3d") {
              const denied = await requirePro();
              if (denied) return denied;
            }
            const game = await createGameRecord(db, {
              userId,
              prompt: op.prompt,
            });
            gameId = game.id;
            await updateGameGeneration(db, userId, game.id, { status: "generating" });
            let spec: GeneratedGameSpec;
            try {
              spec = await generateGameSpec(op.prompt, op.difficulty, undefined, undefined, op.dimension, request.signal);
            } catch (error) {
              const failure = generationFailure(error);
              await recordProductEvent(userId, { event: "game_generation_failed", feature: "games", category: "provider" }).catch(() => undefined);
              console.error("[games] upstream generation failed", {
                requestId,
                gameId,
                model: process.env.LORD_GAME_MODEL ?? DEFAULT_GAME_MODEL,
                upstreamStatus: upstreamStatus(error) ?? null,
                errorName: error instanceof Error ? error.name : "unknown",
                failureType: failure.kind,
              });
              try {
                await updateGameGeneration(db, userId, game.id, { status: "failed" });
              } catch {
                console.error("[games] failed to persist failure status", { requestId, gameId });
              }
              throw failure;
            }
            if (requiresGameProAccess({ spec })) {
              const denied = await requirePro();
              if (denied) {
                try {
                  await updateGameGeneration(db, userId, game.id, { status: "failed" });
                } catch (error) {
                  console.error("[games] could not mark disallowed game generation as failed", {
                    requestId,
                    gameId,
                    errorName: error instanceof Error ? error.name : "unknown",
                  });
                }
                return denied;
              }
            }
            const readyGame = await updateGameGeneration(db, userId, game.id, {
              status: "ready",
              spec,
            });
            await recordProductEvent(userId, { event: "game_generation_succeeded", feature: "games" }).catch(() => undefined);
            return Response.json({ game: readyGame });
          }
          if (op.action === "modify") {
            if (!validateGameSpec(op.spec))
              return Response.json({ error: "Invalid game specification." }, { status: 400 });
            const existing = op.spec.schemaVersion === 1
              ? upgradeLegacyGameSpec(op.spec)
              : op.spec as GeneratedGameSpec;
            if (requiresGameProAccess({ spec: existing })) {
              const denied = await requirePro();
              if (denied) return denied;
            }
            const spec = await generateGameSpec("", existing.difficulty, existing, op.instruction, undefined, request.signal);
            if (requiresGameProAccess({ spec })) {
              const denied = await requirePro();
              if (denied) return denied;
            }
            return Response.json({
              spec,
            });
          }
          if (op.action === "list") {
            const { data, error } = await ownedGamesQuery(db, userId)
              .eq("status", "ready")
              .order("updated_at", { ascending: false })
              .limit(50);
            if (error) throw error;
            const games = data ?? [];
            if (games.some((game: { spec: unknown; versions: unknown[] }) => requiresGameProAccess(game))) {
              const access = await checkPro();
              if (access instanceof Response) return access;
              return Response.json({ games: filterGamesForEntitlement(games, access) });
            }
            return Response.json({ games });
          }
          if (op.action === "get") {
            const { data, error } = await ownedGamesQuery(db, userId)
              .eq("status", "ready")
              .eq("id", op.id)
              .maybeSingle();
            if (error) throw error;
            if (!data) return Response.json({ error: "Game not found." }, { status: 404 });
            if (requiresGameProAccess(data)) {
              const denied = await requirePro();
              if (denied) return denied;
            }
            return Response.json({ game: data });
          }
          if (op.action === "delete") {
            const { error, count } = await scopeGameToOwner(
              db.from("ai_games").delete({ count: "exact" }),
              userId,
              op.id,
            );
            if (error) throw error;
            if (!count) return Response.json({ error: "Game not found." }, { status: 404 });
            return Response.json({ ok: true });
          }
          if (!validateGameSpec(op.spec))
            return Response.json({ error: "Invalid game specification." }, { status: 400 });
          if (op.versions?.some((version) => !validateGameSpec(version)))
            return Response.json({ error: "Invalid game version history." }, { status: 400 });
          if (requiresGameProAccess({ spec: op.spec, versions: op.versions })) {
            const denied = await requirePro();
            if (denied) return denied;
          }
          const payload = {
            user_id: userId,
            spec: op.spec as StoredGameSpec,
            prompt: op.prompt,
            versions: op.versions ?? [],
            status: "ready",
          };
          const query = op.id
            ? scopeGameToOwner(db.from("ai_games").update(payload), userId, op.id)
            : db.from("ai_games").insert(payload);
          const { data, error } = await query
            .select("id,spec,prompt,versions,created_at,updated_at")
            .single();
          if (error) throw error;
          return Response.json({ game: data });
        } catch (error) {
          if (error instanceof GameServiceError) {
            console.warn("[games] operation failed", {
              requestId,
              action,
              failureType: error.kind,
              ...(error.kind === "database"
                ? { databaseErrorCode: databaseErrorCode(error.cause) }
                : {}),
            });
            const statusByKind = {
              auth: 401,
              generation: 502,
              database: 500,
              not_configured: 503,
              rate_limited: 429,
              model_unavailable: 503,
              timeout: 504,
              unsupported: 422,
            } as const;
            const codeByKind = {
              auth: "AI_AUTH_ERROR",
              generation: "AI_GENERATION_FAILED",
              database: "DB_ERROR",
              not_configured: "AI_NOT_CONFIGURED",
              rate_limited: "AI_RATE_LIMITED",
              model_unavailable: "AI_MODEL_UNAVAILABLE",
              timeout: "AI_TIMEOUT",
              unsupported: "GAME_TYPE_UNSUPPORTED",
            } as const;
            return Response.json(
              { error: { code: codeByKind[error.kind], message: error.message, requestId, gameId } },
              {
                status: statusByKind[error.kind],
                headers: error.kind === "rate_limited" ? { "Retry-After": "30" } : undefined,
              },
            );
          }
          const isGenerationAction = action === "generate" || action === "modify";
          const classifiedFailure = isGenerationAction ? generationFailure(error) : null;
          console.error("[games] request failed", {
            requestId,
            gameId,
            action,
            failureType: classifiedFailure?.kind ?? "database_or_request",
            upstreamStatus: upstreamStatus(error) ?? null,
            errorName: error instanceof Error ? error.name : "unknown",
            ...(isGenerationAction ? {} : { databaseErrorCode: databaseErrorCode(error) }),
          });
          return Response.json(
            {
              error: {
                code: classifiedFailure?.kind === "not_configured"
                  ? "AI_NOT_CONFIGURED"
                  : classifiedFailure?.kind === "rate_limited"
                    ? "AI_RATE_LIMITED"
                    : classifiedFailure?.kind === "timeout"
                      ? "AI_TIMEOUT"
                      : classifiedFailure?.kind === "model_unavailable"
                        ? "AI_MODEL_UNAVAILABLE"
                  : isGenerationAction
                          ? "AI_GENERATION_FAILED"
                          : "DB_ERROR",
                message: classifiedFailure?.message ??
                  (isGenerationAction
                    ? "Game generation failed. Please try again."
                    : "The game could not be saved or loaded. Please try again."),
                requestId,
                gameId,
              },
            },
            {
              status: classifiedFailure
                ? classifiedFailure.kind === "generation"
                  ? 502
                  : classifiedFailure.kind === "rate_limited"
                    ? 429
                    : classifiedFailure.kind === "timeout"
                      ? 504
                      : 503
                : 500,
              headers: classifiedFailure?.kind === "rate_limited" ? { "Retry-After": "30" } : undefined,
            },
          );
        }
      },
    },
  },
});
