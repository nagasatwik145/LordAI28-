import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiOkResponse, apiErrorResponse, getSafeErrorMessage } from "@/lib/api-error";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const ProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().max(50).optional(),
  icon: z.string().max(50).optional(),
});

export const Route = createFileRoute("/api/projects/")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        try {
          const { userId, supabase } = context as {
            userId: string;
            supabase: SupabaseClient<Database>;
          };
          const { data, error } = await supabase
            .from("projects")
            .select("*")
            .eq("user_id", userId)
            .order("is_pinned", { ascending: false })
            .order("last_accessed_at", { ascending: false });

          if (error) throw error;
          return apiOkResponse(data ?? []);
        } catch (err) {
          return apiErrorResponse(500, "DB_ERROR", getSafeErrorMessage(err), crypto.randomUUID());
        }
      },
      POST: async ({ request, context }) => {
        try {
          const { userId, supabase } = context as {
            userId: string;
            supabase: SupabaseClient<Database>;
          };
          const body = await request.json();
          const parsed = ProjectSchema.safeParse(body);
          if (!parsed.success) {
            return apiErrorResponse(
              400,
              "INVALID_REQUEST",
              parsed.error.message,
              crypto.randomUUID(),
            );
          }
          const { data, error } = await supabase
            .from("projects")
            .insert({
              user_id: userId,
              name: parsed.data.name,
              description: parsed.data.description ?? null,
              color: parsed.data.color ?? "#3b82f6",
              icon: parsed.data.icon ?? "folder",
            })
            .select()
            .single();

          if (error) throw error;
          return apiOkResponse(data, 201);
        } catch (err) {
          return apiErrorResponse(500, "DB_ERROR", getSafeErrorMessage(err), crypto.randomUUID());
        }
      },
    },
  },
});
