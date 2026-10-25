import { createFileRoute } from "@tanstack/react-router";
import {
  apiOkResponse,
  apiErrorResponse,
  apiNoContentResponse,
  getSafeErrorMessage,
} from "@/lib/api-error";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/knowledge/$id")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context, params }) => {
        try {
          const { userId, supabase } = context as {
            userId: string;
            supabase: SupabaseClient<Database>;
          };
          const { data, error } = await supabase
            .from("knowledge_chunks")
            .select("*")
            .eq("knowledge_source_id", params.id)
            .eq("user_id", userId)
            .order("chunk_index");

          if (error) throw error;
          return apiOkResponse(data ?? []);
        } catch (err) {
          return apiErrorResponse(500, "DB_ERROR", getSafeErrorMessage(err), crypto.randomUUID());
        }
      },
      DELETE: async ({ context, params }) => {
        try {
          const { userId, supabase } = context as {
            userId: string;
            supabase: SupabaseClient<Database>;
          };
          const { error } = await supabase
            .from("knowledge_sources")
            .delete()
            .eq("id", params.id)
            .eq("user_id", userId);

          if (error) throw error;
          return apiNoContentResponse();
        } catch (err) {
          return apiErrorResponse(500, "DB_ERROR", getSafeErrorMessage(err), crypto.randomUUID());
        }
      },
    },
  },
});
