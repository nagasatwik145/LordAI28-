/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase's generated database types update with this migration. */
import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { apiErrorResponse, apiOkResponse } from "@/lib/api-error";
import { DeveloperSessionSchema } from "@/lib/developer-lab";

export const Route = createFileRoute("/api/developer-lab/history")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        const auth = context as { userId?: string; supabase?: { from: (table: string) => any } };
        if (!auth.userId || !auth.supabase) {
          return apiErrorResponse(
            401,
            "AI_AUTH_ERROR",
            "Sign in to view session history.",
            crypto.randomUUID(),
          );
        }
        const { data, error } = await auth.supabase
          .from("developer_lab_sessions")
          .select("id,title,action,language,code,output,created_at")
          .eq("user_id", auth.userId)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error)
          return apiErrorResponse(
            500,
            "DB_ERROR",
            "Could not load Developer Lab history.",
            crypto.randomUUID(),
          );
        return apiOkResponse(data ?? []);
      },
      POST: async ({ request, context }) => {
        const auth = context as { userId?: string; supabase?: { from: (table: string) => any } };
        if (!auth.userId || !auth.supabase) {
          return apiErrorResponse(
            401,
            "AI_AUTH_ERROR",
            "Sign in to save a session.",
            crypto.randomUUID(),
          );
        }
        const parsed = DeveloperSessionSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "Session data is invalid or too large.",
            crypto.randomUUID(),
          );
        }
        const { data, error } = await auth.supabase
          .from("developer_lab_sessions")
          .insert({ ...parsed.data, user_id: auth.userId })
          .select("id,title,action,language,code,output,created_at")
          .single();
        if (error)
          return apiErrorResponse(
            500,
            "DB_ERROR",
            "Could not save Developer Lab session.",
            crypto.randomUUID(),
          );
        return apiOkResponse(data, 201);
      },
    },
  },
});
