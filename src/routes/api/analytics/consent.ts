import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/analytics/consent")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        const { userId } = context as { userId: string };
        // Consent tables are created by this migration; generated Supabase types lag migrations.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabaseAdmin as any)
          .from("analytics_consents")
          .select("enabled")
          .eq("user_id", userId)
          .maybeSingle();
        return Response.json(
          { enabled: data?.enabled ?? false },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      PUT: async ({ request, context }) => {
        const { userId } = context as { userId: string };
        const body = await request.json().catch(() => null);
        if (typeof body?.enabled !== "boolean")
          return Response.json({ error: "enabled must be boolean" }, { status: 400 });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabaseAdmin as any;
        const { error } = await db
          .from("analytics_consents")
          .upsert({ user_id: userId, enabled: body.enabled, updated_at: new Date().toISOString() });
        if (error)
          return Response.json(
            { error: "Could not update analytics preference." },
            { status: 503 },
          );
        if (!body.enabled) {
          const { error: deleteError } = await db
            .from("product_analytics_events")
            .delete()
            .eq("user_id", userId);
          if (deleteError)
            return Response.json(
              { error: "Analytics is disabled, but previous events could not be deleted." },
              { status: 503 },
            );
        }
        return Response.json({ enabled: body.enabled });
      },
    },
  },
});
