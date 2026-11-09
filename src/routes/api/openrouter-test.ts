import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { checkOpenRouterHealth } from "@/lib/ai/openrouter-health.server";
import { readEnvApiKey } from "@/lib/env.server";
import { MODEL_REGISTRY } from "@/lib/ai/models";

type OpenRouterProbe = {
  expiresAt: number;
  response: { ok: boolean; status: string; modelIds: string[]; checkedAt: string };
};

let cachedProbe: OpenRouterProbe | null = null;
const PROBE_CACHE_MS = 15_000;
async function getOpenRouterHealth() {
  if (cachedProbe && cachedProbe.expiresAt > Date.now()) return cachedProbe.response;
  const trackedModelIds = MODEL_REGISTRY.filter((model) => model.provider === "openrouter").map(
    (model) => model.id,
  );
  const response = await checkOpenRouterHealth(
    readEnvApiKey("OPENROUTER_API_KEY"),
    fetch,
    trackedModelIds,
  );
  cachedProbe = {
    response,
    expiresAt: Date.now() + (response.status === "timeout" ? 5_000 : PROBE_CACHE_MS),
  };
  return response;
}

export const Route = createFileRoute("/api/openrouter-test")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async () =>
        Response.json(await getOpenRouterHealth(), {
          headers: { "Cache-Control": "no-store" },
        }),
    },
  },
});
