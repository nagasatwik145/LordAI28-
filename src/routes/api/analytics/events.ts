import { createFileRoute } from "@tanstack/react-router";
import { AnalyticsEventSchema } from "@/lib/analytics-schema";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { recordProductEvent } from "@/lib/analytics.server";

export const Route = createFileRoute("/api/analytics/events")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const parsed = AnalyticsEventSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "Invalid analytics event." }, { status: 400 });
        try {
          await recordProductEvent((context as { userId: string }).userId, parsed.data);
          return new Response(null, { status: 204 });
        } catch {
          return Response.json({ error: "Analytics unavailable." }, { status: 503 });
        }
      },
    },
  },
});
