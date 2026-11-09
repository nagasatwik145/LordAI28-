import { createFileRoute } from "@tanstack/react-router";
import { requireHealthCenterAdmin } from "@/integrations/supabase/auth-middleware";
import type { SystemHealth } from "@/lib/phase2/types";

export const Route = createFileRoute("/api/observability/health")({
  server: {
    middleware: [requireHealthCenterAdmin],
    handlers: {
      GET: async () => {
        const metrics: SystemHealth = {
          providers: {},
          circuitBreakers: {},
          memory: { used: 0, total: 0 },
          embeddingQueue: { pending: 0, processing: 0, failed: 0 },
          backgroundJobs: { pending: 0, running: 0, failed: 0 },
          lastUpdated: new Date().toISOString(),
          status: "healthy",
        };
        return Response.json({ data: metrics });
      },
    },
  },
});
