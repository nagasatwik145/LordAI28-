/* eslint-disable @typescript-eslint/no-explicit-any -- this migration adds the mission table before generated database types are refreshed. */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { apiErrorResponse } from "@/lib/api-error";
import {
  executeVoiceMissionStep,
  planVoiceMission,
  type VoiceMissionStep,
} from "@/lib/voice/mission-engine.server";

const MissionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), goal: z.string().trim().min(3).max(2_000) }),
  z.object({
    action: z.enum(["run", "resume", "pause", "cancel"]),
    missionId: z.string().uuid(),
  }),
]);

type MissionRow = {
  id: string;
  user_id: string;
  goal: string;
  title: string;
  status: "planned" | "running" | "paused" | "completed" | "failed" | "cancelled";
  steps: VoiceMissionStep[];
  created_at: string;
  updated_at: string;
  planner_model_id: string | null;
};

function progressOf(steps: VoiceMissionStep[]) {
  const completed = steps.filter((step) => step.status === "completed").length;
  return {
    completed,
    total: steps.length,
    percent: steps.length ? Math.round((completed / steps.length) * 100) : 0,
  };
}

async function loadMission(missionId: string, userId: string): Promise<MissionRow | null> {
  const { data, error } = await (supabaseAdmin as any)
    .from("lord_voice_missions")
    .select("*")
    .eq("id", missionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as MissionRow | null;
}

async function missionResponse(missionId: string, userId: string) {
  const mission = await loadMission(missionId, userId);
  return mission ? { mission, progress: progressOf(mission.steps ?? []) } : null;
}

async function setMissionStatus(
  missionId: string,
  userId: string,
  status: MissionRow["status"],
  expectedStatus?: MissionRow["status"][],
) {
  let query = (supabaseAdmin as any)
    .from("lord_voice_missions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", missionId)
    .eq("user_id", userId);
  if (expectedStatus) query = query.in("status", expectedStatus);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function executeMission(missionId: string, userId: string, signal: AbortSignal) {
  const initial = await loadMission(missionId, userId);
  if (!initial || !["planned", "paused"].includes(initial.status)) return null;
  const expected = initial.status;
  if (
    !(await setMissionStatus(missionId, userId, "running", [
      expected as "planned" | "paused",
    ]))
  ) {
    return missionResponse(missionId, userId);
  }

  const totalSignal = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  try {
    for (let index = 0; index < initial.steps.length; index += 1) {
      const current = await loadMission(missionId, userId);
      if (!current || current.status !== "running") return missionResponse(missionId, userId);
      const step = current.steps[index];
      if (!step || step.status === "completed") continue;
      if (totalSignal.aborted) {
        await setMissionStatus(missionId, userId, "paused", ["running"]);
        return missionResponse(missionId, userId);
      }

      const runningSteps = current.steps.map((item, position) =>
        position === index ? { ...item, status: "running" as const } : item,
      );
      const { data: claimed, error: claimError } = await (supabaseAdmin as any)
        .from("lord_voice_missions")
        .update({ steps: runningSteps, updated_at: new Date().toISOString() })
        .eq("id", missionId)
        .eq("user_id", userId)
        .eq("status", "running")
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return missionResponse(missionId, userId);

      try {
        const stepSignal = AbortSignal.any([totalSignal, AbortSignal.timeout(25_000)]);
        const result = await executeVoiceMissionStep(
          current.goal,
          runningSteps[index],
          current.steps
            .slice(0, index)
            .flatMap((item) => (item.result ? [item.result] : [])),
          stepSignal,
        );
        const latest = await loadMission(missionId, userId);
        if (!latest) return null;
        const updatedSteps = latest.steps.map((item, position) =>
          position === index
            ? { ...item, status: "completed" as const, result: result.text }
            : item,
        );
        const { error } = await (supabaseAdmin as any)
          .from("lord_voice_missions")
          .update({ steps: updatedSteps, updated_at: new Date().toISOString() })
          .eq("id", missionId)
          .eq("user_id", userId);
        if (error) throw error;
      } catch (error) {
        const latest = await loadMission(missionId, userId);
        if (latest?.status === "running") {
          const failedSteps = latest.steps.map((item, position) =>
            position === index
              ? {
                  ...item,
                  status: "failed" as const,
                  result: error instanceof Error ? error.message : "Mission step failed.",
                }
              : item,
          );
          const { error: updateError } = await (supabaseAdmin as any)
            .from("lord_voice_missions")
            .update({
              status: "failed",
              steps: failedSteps,
              updated_at: new Date().toISOString(),
            })
            .eq("id", missionId)
            .eq("user_id", userId)
            .eq("status", "running");
          if (updateError) throw updateError;
        }
        return missionResponse(missionId, userId);
      }
    }
    await setMissionStatus(missionId, userId, "completed", ["running"]);
    return missionResponse(missionId, userId);
  } catch (error) {
    if (totalSignal.aborted) {
      await setMissionStatus(missionId, userId, "paused", ["running"]);
      return missionResponse(missionId, userId);
    }
    throw error;
  }
}

export const Route = createFileRoute("/api/voice/missions")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        const auth = context as {
          userId: string;
          claims: { email?: string; email_confirmed_at?: string | null };
        };
        try {
          const missionId = new URL(request.url).searchParams.get("id");
          if (missionId) {
            if (!z.string().uuid().safeParse(missionId).success) {
              return apiErrorResponse(400, "INVALID_REQUEST", "Invalid mission ID.", requestId);
            }
            const mission = await missionResponse(missionId, auth.userId);
            return mission
              ? Response.json(mission, { headers: { "Cache-Control": "no-store" } })
              : apiErrorResponse(404, "NOT_FOUND", "Mission not found.", requestId);
          }
          const { data, error } = await (supabaseAdmin as any)
            .from("lord_voice_missions")
            .select("*")
            .eq("user_id", auth.userId)
            .order("updated_at", { ascending: false })
            .limit(25);
          if (error) throw error;
          const missions = (data ?? []).map((mission: MissionRow) => ({
            ...mission,
            progress: progressOf(mission.steps ?? []),
          }));
          return Response.json({ missions }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error("[voice-missions] list failed", { requestId, error });
          return apiErrorResponse(500, "DB_ERROR", "Could not load voice missions.", requestId);
        }
      },
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        const auth = context as {
          userId: string;
          claims: { email?: string; email_confirmed_at?: string | null };
        };
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return apiErrorResponse(400, "INVALID_REQUEST", "Invalid JSON body.", requestId);
        }
        const parsed = MissionActionSchema.safeParse(body);
        if (!parsed.success) {
          return apiErrorResponse(400, "INVALID_REQUEST", "Invalid mission request.", requestId);
        }
        try {
          if (parsed.data.action === "plan") {
            const plan = await planVoiceMission(
              parsed.data.goal,
              AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
            );
            const { data, error } = await (supabaseAdmin as any)
              .from("lord_voice_missions")
              .insert({
                user_id: auth.userId,
                goal: parsed.data.goal,
                title: plan.title,
                status: "planned",
                steps: plan.steps,
                planner_model_id: plan.plannerModelId,
              })
              .select("*")
              .single();
            if (error) throw error;
            return Response.json(
              { mission: data, progress: progressOf(data.steps) },
              { headers: { "Cache-Control": "no-store" } },
            );
          }

          const mission = await loadMission(parsed.data.missionId, auth.userId);
          if (!mission) return apiErrorResponse(404, "NOT_FOUND", "Mission not found.", requestId);
          switch (parsed.data.action) {
            case "pause":
              if (
                mission.status !== "running" ||
                !(await setMissionStatus(mission.id, auth.userId, "paused", ["running"]))
              ) {
                return apiErrorResponse(
                  409,
                  "INVALID_ACTION",
                  "Only a running mission can be paused.",
                  requestId,
                );
              }
              break;
            case "cancel":
              if (["completed", "cancelled"].includes(mission.status)) {
                return apiErrorResponse(
                  409,
                  "INVALID_ACTION",
                  "This mission has already finished.",
                  requestId,
                );
              }
              await setMissionStatus(mission.id, auth.userId, "cancelled");
              break;
            case "run":
              if (mission.status !== "planned") {
                return apiErrorResponse(
                  409,
                  "INVALID_ACTION",
                  "Only a planned mission can be started.",
                  requestId,
                );
              }
              break;
            case "resume":
              if (mission.status !== "paused") {
                return apiErrorResponse(
                  409,
                  "INVALID_ACTION",
                  "Only a paused mission can be resumed.",
                  requestId,
                );
              }
              break;
          }

          if (parsed.data.action === "run" || parsed.data.action === "resume") {
            const result = await executeMission(
              mission.id,
              auth.userId,
              request.signal,
            );
            if (!result) return apiErrorResponse(404, "NOT_FOUND", "Mission not found.", requestId);
            return Response.json(result, { headers: { "Cache-Control": "no-store" } });
          }
          const updated = await missionResponse(mission.id, auth.userId);
          return Response.json(updated, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          console.error("[voice-missions] request failed", {
            requestId,
            action: parsed.data.action,
            errorName: error instanceof Error ? error.name : "unknown",
          });
          const status = error instanceof Error && error.name === "TimeoutError" ? 504 : 500;
          return apiErrorResponse(
            status,
            status === 504 ? "AI_TIMEOUT" : "DB_ERROR",
            "The voice mission request failed. Please try again.",
            requestId,
          );
        }
      },
    },
  },
});
