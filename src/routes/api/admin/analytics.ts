import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { isGrowthAdmin } from "@/lib/analytics.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/admin/analytics")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ request, context }) => {
        const { userId } = context as { userId: string };
        if (!isGrowthAdmin(userId)) return Response.json({ error: "Forbidden" }, { status: 403 });
        const url = new URL(request.url);
        const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days")) || 30));
        const from = new Date(Date.now() - days * 86400000).toISOString();
        // Analytics tables are added by a migration before generated Supabase types are refreshed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const db = supabaseAdmin as any;
        const { data: rows, error } = await db
          .from("product_analytics_events")
          .select("event_name,feature,category,created_at")
          .gte("created_at", from)
          .order("created_at", { ascending: false })
          .limit(5000);
        if (error) return Response.json({ error: "Analytics query failed." }, { status: 503 });
        const events: Record<string, number> = {},
          features: Record<string, number> = {},
          failures: Record<string, number> = {};
        const daysSet = new Set<string>();
        for (const row of rows ?? []) {
          events[row.event_name] = (events[row.event_name] ?? 0) + 1;
          if (row.feature) features[row.feature] = (features[row.feature] ?? 0) + 1;
          if (row.category) failures[row.category] = (failures[row.category] ?? 0) + 1;
          daysSet.add(row.created_at.slice(0, 10));
        }
        const total = (rows ?? []).length;
        const success = (events.chat_succeeded ?? 0) + (events.game_generation_succeeded ?? 0);
        const fail = (events.chat_failed ?? 0) + (events.game_generation_failed ?? 0);
        const { data: entitlements, error: entError } = await db
          .from("pro_entitlements")
          .select("status,expires_at")
          .limit(5000);
        if (entError)
          return Response.json({ error: "Subscription health query failed." }, { status: 503 });
        const entitlementRows = (entitlements ?? []) as {
          status: string;
          expires_at: string | null;
        }[];
        const active = entitlementRows.filter(
          (e) =>
            ["active", "cancelled"].includes(e.status) &&
            e.expires_at &&
            Date.parse(e.expires_at) > Date.now(),
        ).length;
        return Response.json(
          {
            rangeDays: days,
            from,
            to: new Date().toISOString(),
            sampleEvents: total,
            sampleActiveDays: daysSet.size,
            truncated: total === 5000,
            events,
            features,
            failures,
            reliability: { successes: success, failures: fail, sampleRequests: success + fail },
            subscriptions: {
              sampleEntitlements: entitlementRows.length,
              activeUnexpired: active,
              inconsistent: entitlementRows.filter(
                (e) =>
                  e.status === "active" &&
                  (!e.expires_at || Date.parse(e.expires_at) <= Date.now()),
              ).length,
            },
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
