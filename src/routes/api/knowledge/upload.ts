import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiOkResponse, apiErrorResponse, getSafeErrorMessage } from "@/lib/api-error";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const UploadSchema = z.object({
  name: z.string().min(1).max(200),
  sourceType: z.string().max(50),
  contentText: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  projectId: z.string().uuid().optional().nullable(),
  mimeType: z.string().optional(),
  fileSizeBytes: z.coerce.number().int().nonnegative().optional(),
});

export const Route = createFileRoute("/api/knowledge/upload")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        try {
          const { userId, supabase } = context as {
            userId: string;
            supabase: SupabaseClient<Database>;
          };
          const body = await request.json();
          const parsed = UploadSchema.safeParse(body);
          if (!parsed.success) {
            return apiErrorResponse(
              400,
              "INVALID_REQUEST",
              parsed.error.message,
              crypto.randomUUID(),
            );
          }
          if (parsed.data.projectId) {
            const { data: project, error: projectError } = await supabase
              .from("projects")
              .select("id")
              .eq("id", parsed.data.projectId)
              .eq("user_id", userId)
              .maybeSingle();
            if (projectError) throw projectError;
            if (!project) {
              return apiErrorResponse(404, "NOT_FOUND", "Project not found", crypto.randomUUID());
            }
          }
          const { data, error } = await supabase
            .from("knowledge_sources")
            .insert({
              user_id: userId,
              project_id: parsed.data.projectId ?? null,
              name: parsed.data.name,
              source_type: parsed.data.sourceType,
              content_text: parsed.data.contentText ?? null,
              source_url: parsed.data.sourceUrl ?? null,
              mime_type: parsed.data.mimeType ?? null,
              file_size_bytes: parsed.data.fileSizeBytes ?? 0,
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
