/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase's generated database type predates this migration. */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { apiErrorResponse, apiOkResponse } from "@/lib/api-error";
import { recordProductEvent } from "@/lib/analytics.server";

const FocusSessionSchema = z
  .object({
    id: z.string().uuid(),
    mode: z.enum(["countdown", "pomodoro", "stopwatch"]),
    status: z.enum(["completed", "interrupted"]),
    subject: z.string().trim().max(100).nullable(),
    label: z.string().trim().max(160).nullable(),
    duration_seconds: z.number().int().min(0).max(604800),
    planned_seconds: z.number().int().min(1).max(86400).nullable(),
    started_at: z.string().datetime({ offset: true }),
    completed_at: z.string().datetime({ offset: true }),
  })
  .superRefine((record, context) => {
    const start = Date.parse(record.started_at);
    const end = Date.parse(record.completed_at);
    const elapsed = (end - start) / 1000;
    if (elapsed < 0 || elapsed > 7 * 86400) {
      context.addIssue({
        code: "custom",
        path: ["completed_at"],
        message: "Session timestamps are outside the supported range.",
      });
    }
    if (record.duration_seconds > elapsed + 1) {
      context.addIssue({
        code: "custom",
        path: ["duration_seconds"],
        message: "Focused time cannot exceed the session's elapsed time.",
      });
    }
    if (start > Date.now() + 60_000) {
      context.addIssue({
        code: "custom",
        path: ["started_at"],
        message: "Session start cannot be in the future.",
      });
    }
    if (end > Date.now() + 60_000) {
      context.addIssue({
        code: "custom",
        path: ["completed_at"],
        message: "Session completion cannot be in the future.",
      });
    }
  });

export const Route = createFileRoute("/api/learning/focus-sessions")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        const requestId = crypto.randomUUID();
        const auth = context as { userId?: string; supabase?: { from: (table: string) => any } };
        if (!auth.userId || !auth.supabase) {
          return apiErrorResponse(
            401,
            "AI_AUTH_ERROR",
            "Sign in to view study sessions.",
            requestId,
          );
        }
        const { data, error } = await auth.supabase
          .from("study_focus_sessions")
          .select(
            "id, mode, status, subject, label, duration_seconds, planned_seconds, started_at, completed_at",
          )
          .eq("user_id", auth.userId)
          .order("completed_at", { ascending: false })
          .limit(400);
        if (error) {
          console.error("Study focus sessions query failed:", error);
          return apiErrorResponse(500, "DB_ERROR", "Could not load study sessions.", requestId);
        }
        return apiOkResponse({ sessions: data ?? [] });
      },
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        const auth = context as { userId?: string; supabase?: { from: (table: string) => any } };
        if (!auth.userId || !auth.supabase) {
          return apiErrorResponse(
            401,
            "AI_AUTH_ERROR",
            "Sign in to save study sessions.",
            requestId,
          );
        }
        const parsed = FocusSessionSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "Invalid study focus session.",
            requestId,
          );
        }
        const db = auth.supabase;
        const { data: existing, error: lookupError } = await db
          .from("study_focus_sessions")
          .select(
            "id, mode, status, subject, label, duration_seconds, planned_seconds, started_at, completed_at",
          )
          .eq("id", parsed.data.id)
          .eq("user_id", auth.userId)
          .maybeSingle();
        if (lookupError) {
          console.error("Study focus session lookup failed:", lookupError);
          return apiErrorResponse(500, "DB_ERROR", "Could not save study session.", requestId);
        }
        if (existing) return apiOkResponse({ session: existing });

        const { data, error } = await db
          .from("study_focus_sessions")
          .insert({ ...parsed.data, user_id: auth.userId })
          .select(
            "id, mode, status, subject, label, duration_seconds, planned_seconds, started_at, completed_at",
          )
          .single();
        if (error) {
          if (error.code === "23505") {
            const { data: duplicate, error: duplicateError } = await db
              .from("study_focus_sessions")
              .select(
                "id, mode, status, subject, label, duration_seconds, planned_seconds, started_at, completed_at",
              )
              .eq("id", parsed.data.id)
              .eq("user_id", auth.userId)
              .maybeSingle();
            if (!duplicateError && duplicate) return apiOkResponse({ session: duplicate });
          }
          console.error("Study focus session insert failed:", error);
          return apiErrorResponse(500, "DB_ERROR", "Could not save study session.", requestId);
        }
        if (parsed.data.status === "completed")
          await recordProductEvent(auth.userId, {
            event: "study_session_completed",
            feature: "study",
            durationMs: parsed.data.duration_seconds * 1000,
          }).catch(() => undefined);
        return apiOkResponse({ session: data }, 201);
      },
    },
  },
});
