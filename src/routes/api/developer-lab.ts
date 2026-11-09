import { createFileRoute } from "@tanstack/react-router";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { apiErrorResponse } from "@/lib/api-error";
import { DeveloperRequestSchema } from "@/lib/developer-lab";
import {
  DEVELOPER_LAB_MODEL,
  buildDeveloperLabSystemPrompt,
  buildDeveloperLabUserPrompt,
} from "@/lib/developer-lab-quality";

function getProvider() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("AI is not configured");
  return createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  });
}

export const Route = createFileRoute("/api/developer-lab")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request }) => {
        const requestId = crypto.randomUUID();
        const parsed = DeveloperRequestSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "Provide a supported action and code under 40 KB.",
            requestId,
          );
        }
        try {
          const input = parsed.data;
          const result = streamText({
            model: getProvider()(DEVELOPER_LAB_MODEL),
            system: buildDeveloperLabSystemPrompt(input.action),
            prompt: buildDeveloperLabUserPrompt(input),
            temperature: 0.2,
            maxOutputTokens: 3500,
          });

          return result.toTextStreamResponse({
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Lord-Evidence": "ai_suggestion",
              "X-Lord-Executed": "false",
              "X-Lord-Developer-Lab-Model": DEVELOPER_LAB_MODEL,
            },
          });
        } catch (error) {
          const message =
            error instanceof Error && error.message === "AI is not configured"
              ? "AI analysis is not configured on this server."
              : "The analysis could not be completed. Please try again.";
          return apiErrorResponse(503, "AI_UPSTREAM_ERROR", message, requestId);
        }
      },
    },
  },
});
