/* eslint-disable @typescript-eslint/no-explicit-any -- server context receives the migration-defined database client. */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { apiErrorResponse } from "@/lib/api-error";

const VoiceRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("stt"),
    audioBase64: z.string().min(1),
    language: z.string().default("en"),
  }),
  z.object({
    action: z.literal("tts"),
    text: z.string().min(1).max(5000),
    voice: z.string().default("alloy"),
    language: z.string().default("en"),
  }),
  z.object({
    action: z.literal("start_session"),
    conceptId: z.string().optional(),
    mode: z.enum(["stt", "tts", "conversational"]).default("conversational"),
    language: z.string().default("en"),
  }),
  z.object({
    action: z.literal("end_session"),
    sessionId: z.string().uuid(),
    transcript: z.string().optional(),
    durationSeconds: z.number().int().optional(),
  }),
  z.object({
    action: z.literal("get_session"),
    sessionId: z.string().uuid(),
  }),
]);

export const Route = createFileRoute("/api/learning/voice")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        const parsed = VoiceRequestSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return apiErrorResponse(400, "INVALID_REQUEST", "Invalid voice request.", requestId);

        const auth = context as {
          userId?: string;
          supabase?: { from: (table: string) => any };
          claims?: { email?: string; email_confirmed_at?: string | null };
        };
        if (!auth.userId || !auth.supabase)
          return apiErrorResponse(
            401,
            "AI_AUTH_ERROR",
            "Sign in to use learning tools.",
            requestId,
          );

        const db = auth.supabase;
        const userId = auth.userId;

        try {
          if (parsed.data.action === "stt") {
            return apiErrorResponse(
              503,
              "AI_NOT_CONFIGURED",
              "Speech-to-text is not configured for study voice sessions.",
              requestId,
            );
          }

          if (parsed.data.action === "tts") {
            return apiErrorResponse(
              503,
              "AI_NOT_CONFIGURED",
              "Text-to-speech is not configured for study voice sessions.",
              requestId,
            );
          }

          if (parsed.data.action === "start_session") {
            const { data, error } = await db
              .from("learning_voice_sessions")
              .insert({
                user_id: userId,
                concept_id: parsed.data.conceptId,
                mode: parsed.data.mode,
                language: parsed.data.language,
                status: "active",
              })
              .select()
              .single();

            if (error) throw error;
            return Response.json({ session: data });
          }

          if (parsed.data.action === "end_session") {
            const { data, error } = await db
              .from("learning_voice_sessions")
              .update({
                status: "completed",
                ended_at: new Date().toISOString(),
                transcript: parsed.data.transcript,
                duration_seconds: parsed.data.durationSeconds,
              })
              .eq("id", parsed.data.sessionId)
              .eq("user_id", userId)
              .select()
              .single();

            if (error) throw error;
            return Response.json({ session: data });
          }

          if (parsed.data.action === "get_session") {
            const { data, error } = await db
              .from("learning_voice_sessions")
              .select("*")
              .eq("id", parsed.data.sessionId)
              .eq("user_id", userId)
              .maybeSingle();

            if (error) throw error;
            if (!data) return apiErrorResponse(404, "NOT_FOUND", "Session not found.", requestId);
            return Response.json({ session: data });
          }

          return apiErrorResponse(400, "INVALID_ACTION", "Unknown action.", requestId);
        } catch (err) {
          console.error("Voice error:", err);
          return apiErrorResponse(500, "INTERNAL_ERROR", "Voice service unavailable.", requestId);
        }
      },
    },
  },
});
