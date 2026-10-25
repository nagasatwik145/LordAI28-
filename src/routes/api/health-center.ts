import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { checkHealthCenterRateLimit, createHealthCenterSnapshot } from "@/lib/health-center.server";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/health-center")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context, request }) => {
        const auth = context as {
          userId: string;
          supabase: SupabaseClient<Database>;
        };
        if (!checkHealthCenterRateLimit(auth.userId)) {
          return Response.json(
            { error: "Diagnostics are being refreshed too frequently. Try again shortly." },
            {
              status: 429,
              headers: { "Cache-Control": "no-store", "Retry-After": "60" },
            },
          );
        }

        const activeChecks = new URL(request.url).searchParams.get("active") === "1";
        const snapshot = await createHealthCenterSnapshot({
          activeChecks,
          requestSignal: request.signal,
          databaseCheck: async (signal) => {
            const { error } = await auth.supabase
              .from("profiles")
              .select("id", { head: true })
              .limit(1)
              .abortSignal(signal);
            if (error) throw error;
          },
        });

        return Response.json(snapshot, {
          headers: { "Cache-Control": "private, no-store" },
        });
      },
    },
  },
});
