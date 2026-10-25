import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  apiOkResponse,
  apiErrorResponse,
  apiNoContentResponse,
  getSafeErrorMessage,
} from "@/lib/api-error";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().max(50).optional(),
  icon: z.string().max(50).optional(),
  is_pinned: z.boolean().optional(),
  is_archived: z.boolean().optional(),
});

export const Route = createFileRoute("/api/projects/$id")({
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
            .from("projects")
            .select("*")
            .eq("id", params.id)
            .eq("user_id", userId)
            .maybeSingle();

          if (error) throw error;
          if (!data) {
            return apiErrorResponse(404, "NOT_FOUND", "Project not found", crypto.randomUUID());
          }
          return apiOkResponse(data);
        } catch (err) {
          return apiErrorResponse(500, "DB_ERROR", getSafeErrorMessage(err), crypto.randomUUID());
        }
      },
      PATCH: async ({ request, context, params }) => {
        try {
          const { userId, supabase } = context as {
            userId: string;
            supabase: SupabaseClient<Database>;
          };
          const body = await request.json();
          const parsed = UpdateProjectSchema.safeParse(body);
          if (!parsed.success) {
            return apiErrorResponse(
              400,
              "INVALID_REQUEST",
              parsed.error.message,
              crypto.randomUUID(),
            );
          }
          const { error } = await supabase
            .from("projects")
            .update(parsed.data)
            .eq("id", params.id)
            .eq("user_id", userId);

          if (error) throw error;
          return apiOkResponse({ ok: true });
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
            .from("projects")
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
