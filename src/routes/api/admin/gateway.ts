import { createFileRoute } from "@tanstack/react-router";
import { MODEL_REGISTRY } from "@/lib/ai/models";
import { checkImageHealth } from "@/lib/ai/image";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { isGrowthAdmin } from "@/lib/analytics.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/admin/gateway")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        if (!isGrowthAdmin((context as { userId: string }).userId))
          return Response.json({ error: "Forbidden" }, { status: 403 });
        return Response.json({
          timestamp: Date.now(),
          providerConfiguration: [],
          providers: {},
          imageProvider: await checkImageHealth(),
          registry: MODEL_REGISTRY,
        });
      },
      POST: async ({ request, context }) => {
        const adminId = (context as { userId: string }).userId;
        if (!isGrowthAdmin(adminId)) return Response.json({ error: "Forbidden" }, { status: 403 });
        const action =
          (request.headers.get("content-type")?.includes("application/json")
            ? (await request.json().catch(() => ({})))?.action
            : new URL(request.url).searchParams.get("action")) ?? "reset";
        if (action === "reset" || action === "reload-env") {
          console.info(
            JSON.stringify({
              event: "admin_sensitive_action",
              actor: adminId,
              action,
              at: new Date().toISOString(),
            }),
          );
          // Audit table is introduced by the growth migration.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (supabaseAdmin as any)
            .from("admin_action_audit")
            .insert({ actor_user_id: adminId, action });
          if (error)
            return Response.json(
              { ok: false, message: "Could not record administrative action." },
              { status: 503 },
            );
          return Response.json({ ok: true, message: "No provider state is active in Phase 1" });
        }
        return Response.json({ ok: false, message: `Unknown action: ${action}` }, { status: 400 });
      },
    },
  },
});
