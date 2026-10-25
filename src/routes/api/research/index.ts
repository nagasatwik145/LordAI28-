import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { apiErrorResponse, apiOkResponse } from "@/lib/api-error";
import {
  checkWebSearchRateLimit,
  readTavilyApiKey,
  searchWebSources,
} from "@/lib/ai/tavily-search.server";
import {
  deduplicateResearchSources,
  planResearch,
  synthesizeResearch,
} from "@/lib/ai/deep-research.server";
import type { WebSource } from "@/lib/ai/web-sources";

const RequestSchema = z.object({
  question: z.string().trim().min(5).max(500),
  scope: z.string().trim().max(500).optional(),
  dateRange: z.string().trim().max(100).optional(),
  sourcePreferences: z.array(z.string().trim().min(1).max(100)).max(8).optional(),
  projectId: z.string().uuid().optional().nullable(),
});

export const Route = createFileRoute("/api/research/")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const auth = context as { userId?: string; supabase?: SupabaseClient };
        const requestId = crypto.randomUUID();
        if (!auth.userId || !auth.supabase)
          return apiErrorResponse(401, "AI_AUTH_ERROR", "Sign in required.", requestId);
        const body = await request.json().catch(() => null);
        const parsed = RequestSchema.safeParse(body);
        if (!parsed.success)
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "Provide a research question between 5 and 500 characters and valid optional scope fields.",
            requestId,
          );
        const tavilyKey = readTavilyApiKey();
        if (!tavilyKey)
          return apiErrorResponse(
            503,
            "WEB_SEARCH_NOT_CONFIGURED",
            "Deep Research requires TAVILY_API_KEY configured on the server.",
            requestId,
          );
        const aiKey = process.env.OPENROUTER_API_KEY;
        if (!aiKey)
          return apiErrorResponse(
            503,
            "AI_NOT_CONFIGURED",
            "Research report generation requires OPENROUTER_API_KEY configured on the server.",
            requestId,
          );
        if (parsed.data.projectId) {
          const { data: project } = await auth.supabase
            .from("projects")
            .select("id")
            .eq("id", parsed.data.projectId)
            .eq("user_id", auth.userId)
            .maybeSingle();
          if (!project)
            return apiErrorResponse(404, "NOT_FOUND", "Workspace project not found.", requestId);
        }
        const controller = new AbortController();
        const onAbort = () => controller.abort(request.signal.reason);
        request.signal.addEventListener("abort", onAbort, { once: true });
        let sessionId: string | undefined;
        try {
          if (!checkWebSearchRateLimit(auth.userId))
            return apiErrorResponse(
              429,
              "WEB_SEARCH_RATE_LIMITED",
              "Research is limited to 10 searches per minute per account.",
              requestId,
            );
          const queries = await planResearch(parsed.data, controller.signal);
          const results: WebSource[] = [];
          let searchFailures = 0;
          for (const query of queries.slice(0, 3)) {
            if (controller.signal.aborted)
              throw new DOMException("Research cancelled", "AbortError");
            if (query !== queries[0] && !checkWebSearchRateLimit(auth.userId)) break;
            try {
              results.push(
                ...(await searchWebSources(query, tavilyKey, controller.signal, {
                  maxResults: 5,
                  searchDepth: "advanced",
                })),
              );
            } catch (error) {
              if (controller.signal.aborted) throw error;
              searchFailures++;
            }
          }
          const sources = deduplicateResearchSources(results);
          if (!sources.length && searchFailures)
            return apiErrorResponse(
              503,
              "WEB_SEARCH_UNAVAILABLE",
              "The configured search provider failed. Please retry later.",
              requestId,
            );
          const report = await synthesizeResearch(parsed.data, sources, controller.signal);
          const status =
            sources.length &&
            sources.some((source) => source.verification === "page") &&
            !searchFailures
              ? "complete"
              : "partial";
          const { data: session, error: sessionError } = await auth.supabase
            .from("research_sessions")
            .insert({
              user_id: auth.userId,
              project_id: parsed.data.projectId ?? null,
              query: parsed.data.question,
              depth: "deep",
              status,
              report,
              summary:
                report
                  .split("\n")
                  .find((line) => line.trim() && !line.startsWith("#"))
                  ?.slice(0, 500) ?? null,
              confidence_level:
                sources.filter((source) => source.verification === "page").length >= 3
                  ? "moderate"
                  : "limited",
              search_provider: "tavily",
              completed_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (sessionError || !session)
            throw new Error("Could not save the private research report.");
          sessionId = session.id;
          if (sources.length) {
            const { error } = await auth.supabase.from("research_sources").insert(
              sources.map((source) => ({
                research_session_id: session.id,
                user_id: auth.userId,
                url: source.url,
                title: source.title,
                domain: source.domain,
                snippet: source.verification === "snippet" ? source.content : null,
                content_text: source.verification === "page" ? source.content : null,
                published_at:
                  source.publishedDate && !Number.isNaN(Date.parse(source.publishedDate))
                    ? new Date(source.publishedDate).toISOString()
                    : null,
                is_used: source.verification === "page",
              })),
            );
            if (error) throw new Error("Could not save the research evidence.");
          }
          return apiOkResponse({
            id: session.id,
            status,
            report,
            queries,
            sources: sources.map((source, index) => ({
              id: `S${index + 1}`,
              ...source,
              retrievedAt: new Date().toISOString(),
            })),
            searchFailures,
          });
        } catch (error) {
          if (sessionId)
            await auth.supabase
              .from("research_sessions")
              .delete()
              .eq("id", sessionId)
              .eq("user_id", auth.userId);
          if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError"))
            return apiErrorResponse(499, "REQUEST_CANCELLED", "Research was cancelled.", requestId);
          console.error("deep_research_failed", {
            requestId,
            error: error instanceof Error ? error.message : "unknown",
          });
          return apiErrorResponse(
            503,
            "RESEARCH_FAILED",
            error instanceof Error ? error.message : "Research could not be completed.",
            requestId,
          );
        } finally {
          request.signal.removeEventListener("abort", onAbort);
        }
      },
    },
  },
});
