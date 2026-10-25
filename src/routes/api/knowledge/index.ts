import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiOkResponse, apiErrorResponse, getSafeErrorMessage } from "@/lib/api-error";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/knowledge/")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context, request }) => {
        try {
          const { userId, supabase } = context as {
            userId: string;
            supabase: SupabaseClient<Database>;
          };
          const url = new URL(request.url);
          const projectId = url.searchParams.get("projectId") ?? undefined;
          let query = supabase
            .from("knowledge_sources")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

          if (projectId) {
            query = query.eq("project_id", projectId);
          }

          const { data, error } = await query;
          if (error) throw error;
          return apiOkResponse(data ?? []);
        } catch (err) {
          return apiErrorResponse(500, "DB_ERROR", getSafeErrorMessage(err), crypto.randomUUID());
        }
      },
    },
  },
});
