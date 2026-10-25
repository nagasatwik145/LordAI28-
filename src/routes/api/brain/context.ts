import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiOkResponse, apiErrorResponse, getSafeErrorMessage } from "@/lib/api-error";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { buildBrainContext, type BrainContextOptions } from "@/lib/brain/context";

const ContextQuerySchema = z.object({
  query: z.string().min(1).max(500),
  projectId: z.string().uuid().optional().nullable(),
  maxMemories: z.coerce.number().int().max(20).optional(),
  maxKnowledgeChunks: z.coerce.number().int().max(10).optional(),
  maxRecentChats: z.coerce.number().int().max(10).optional(),
});

export const Route = createFileRoute("/api/brain/context")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context, request }) => {
        try {
          const { userId, supabase } = context as {
            userId: string;
            supabase: NonNullable<Parameters<typeof buildBrainContext>[1]>;
          };
          const url = new URL(request.url);
          const parsed = ContextQuerySchema.safeParse({
            query: url.searchParams.get("query") ?? "",
            projectId: url.searchParams.get("projectId") ?? undefined,
            maxMemories: url.searchParams.get("maxMemories") ?? undefined,
            maxKnowledgeChunks: url.searchParams.get("maxKnowledgeChunks") ?? undefined,
            maxRecentChats: url.searchParams.get("maxRecentChats") ?? undefined,
          });
          if (!parsed.success) {
            return apiErrorResponse(
              400,
              "INVALID_REQUEST",
              parsed.error.message,
              crypto.randomUUID(),
            );
          }
          if (parsed.data.projectId) {
            const { data: ownedProject, error } = await supabase
              .from("projects")
              .select("id")
              .eq("id", parsed.data.projectId)
              .eq("user_id", userId)
              .maybeSingle();
            if (error || !ownedProject) {
              return apiErrorResponse(404, "NOT_FOUND", "Project not found", crypto.randomUUID());
            }
          }
          const opts: BrainContextOptions = {
            userId,
            projectId: parsed.data.projectId ?? null,
            query: parsed.data.query,
            maxMemories: parsed.data.maxMemories,
            maxKnowledgeChunks: parsed.data.maxKnowledgeChunks,
            maxRecentChats: parsed.data.maxRecentChats,
          };
          const result = await buildBrainContext(opts, supabase);
          return apiOkResponse(result);
        } catch (err) {
          return apiErrorResponse(500, "DB_ERROR", getSafeErrorMessage(err), crypto.randomUUID());
        }
      },
    },
  },
});
