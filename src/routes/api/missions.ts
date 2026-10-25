import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { hasProEntitlement } from "@/lib/billing/entitlements.server";
import { ALL_MISSION_ACTIONS } from "@/lib/autopilot/mission-engine";
import {
  abortLocalMission,
  approveMission,
  checkMissionPlanningRateLimit,
  clarifyMissionPlan,
  configuredMissionActions,
  controlMission,
  createMissionPlan,
  executeMissionStep,
  MissionServiceError,
} from "@/lib/autopilot/mission-service.server";
import { createMissionStore, type MissionDatabase } from "@/lib/autopilot/mission-store.server";
import { recordProductEvent } from "@/lib/analytics.server";

const MissionRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("plan"),
      objective: z.string().trim().min(1).max(2_000),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("clarify"),
      missionId: z.string().uuid(),
      answers: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      action: z.enum(["approve", "pause", "resume", "cancel", "retry", "run"]),
      missionId: z.string().uuid(),
    })
    .strict(),
]);

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function getIdentity(userId: string, claims: unknown) {
  const claimRecord =
    claims && typeof claims === "object" ? (claims as Record<string, unknown>) : {};
  return {
    id: userId,
    ...(typeof claimRecord.email === "string" ? { email: claimRecord.email } : {}),
    ...(typeof claimRecord.email_confirmed_at === "string" ||
    claimRecord.email_confirmed_at === null
      ? { email_confirmed_at: claimRecord.email_confirmed_at }
      : {}),
  };
}

function errorResponse(error: unknown) {
  if (error instanceof MissionServiceError) {
    const statuses = {
      invalid: 400,
      not_found: 404,
      conflict: 409,
      busy: 409,
      forbidden: 403,
      not_configured: 503,
      rate_limited: 429,
      tool: 502,
    } as const;
    return json(
      { error: { code: error.kind.toUpperCase(), message: error.message } },
      statuses[error.kind],
    );
  }
  console.error("[autopilot] mission request failed", {
    errorName: error instanceof Error ? error.name : "unknown",
  });
  return json(
    {
      error: {
        code: "MISSION_REQUEST_FAILED",
        message: "The mission request could not be completed.",
      },
    },
    500,
  );
}

export const Route = createFileRoute("/api/missions")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ request, context }) => {
        const auth = context as {
          userId: string;
          claims: unknown;
        };
        try {
          const identity = getIdentity(auth.userId, auth.claims);
          if (!(await hasProEntitlement(identity))) {
            return json(
              {
                error: {
                  code: "PRO_REQUIRED",
                  message: "LORD Autopilot requires a LORD Pro subscription.",
                },
              },
              403,
            );
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const store = createMissionStore(supabaseAdmin as unknown as MissionDatabase);
          const missionId = new URL(request.url).searchParams.get("id");
          if (missionId) {
            const mission = await store.get(missionId, auth.userId);
            return mission
              ? json({ mission, availableActions: configuredMissionActions() })
              : json({ error: { code: "NOT_FOUND", message: "Mission not found." } }, 404);
          }
          const missions = await store.list(auth.userId);
          return json({
            missions,
            availableActions: configuredMissionActions(),
            supportedActions: ALL_MISSION_ACTIONS,
          });
        } catch (error) {
          return errorResponse(error);
        }
      },

      POST: async ({ request, context }) => {
        const auth = context as {
          userId: string;
          claims: unknown;
        };
        try {
          const contentLength = Number(request.headers.get("content-length") ?? 0);
          if (contentLength > 20_000) {
            return json(
              { error: { code: "INVALID_REQUEST", message: "Mission requests are too large." } },
              413,
            );
          }
          let payload: unknown;
          try {
            const body = await request.text();
            if (body.length > 20_000) {
              return json(
                { error: { code: "INVALID_REQUEST", message: "Mission requests are too large." } },
                413,
              );
            }
            payload = JSON.parse(body);
          } catch {
            return json(
              { error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } },
              400,
            );
          }
          const input = MissionRequestSchema.safeParse(payload);
          if (!input.success) {
            return json(
              { error: { code: "INVALID_REQUEST", message: "Invalid mission request." } },
              400,
            );
          }
          const identity = getIdentity(auth.userId, auth.claims);
          if (!(await hasProEntitlement(identity))) {
            return json(
              {
                error: {
                  code: "PRO_REQUIRED",
                  message: "LORD Autopilot requires a LORD Pro subscription.",
                },
              },
              403,
            );
          }
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const store = createMissionStore(supabaseAdmin as unknown as MissionDatabase);
          const operation = input.data;

          if (operation.action === "plan") {
            const duplicate = await store.getByIdempotencyKey(auth.userId, operation.requestId);
            if (duplicate && duplicate.objective !== operation.objective) {
              throw new MissionServiceError(
                "conflict",
                "This request ID was already used for a different mission goal.",
              );
            }
            if (duplicate && duplicate.status !== "planning") return json({ mission: duplicate });
            if (!checkMissionPlanningRateLimit(auth.userId)) {
              throw new MissionServiceError(
                "rate_limited",
                "Mission planning is limited to five requests per hour.",
              );
            }
            const recentMissions = await store.list(auth.userId, 20);
            const activeMissions = recentMissions.filter((mission) =>
              [
                "planning",
                "needs_clarification",
                "needs_approval",
                "planned",
                "running",
                "paused",
              ].includes(mission.status),
            ).length;
            if (activeMissions >= 3) {
              throw new MissionServiceError(
                "rate_limited",
                "Finish or cancel an active mission before creating another.",
              );
            }
            const mission = await createMissionPlan(store, {
              userId: auth.userId,
              identity,
              objective: operation.objective,
              idempotencyKey: operation.requestId,
              signal: request.signal,
            });
            return json({ mission }, 201);
          }

          if (operation.action === "clarify") {
            const mission = await clarifyMissionPlan(store, {
              userId: auth.userId,
              identity,
              missionId: operation.missionId,
              answers: operation.answers,
              signal: request.signal,
            });
            return json({ mission });
          }

          if (operation.action === "approve") {
            return json({ mission: await approveMission(store, auth.userId, operation.missionId) });
          }
          if (
            operation.action === "pause" ||
            operation.action === "cancel" ||
            operation.action === "resume" ||
            operation.action === "retry"
          ) {
            const mission = await controlMission(
              store,
              auth.userId,
              operation.missionId,
              operation.action,
            );
            if (operation.action === "pause" || operation.action === "cancel") {
              abortLocalMission(auth.userId, operation.missionId);
            }
            return json({ mission });
          }
          const mission = await executeMissionStep(store, auth.userId, operation.missionId, identity);
          if (mission.status === "completed") await recordProductEvent(auth.userId, { event: "mission_completed", feature: "missions" }).catch(() => undefined);
          if (mission.status === "failed") await recordProductEvent(auth.userId, { event: "mission_failed", feature: "missions", category: "provider" }).catch(() => undefined);
          return json({ mission });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
