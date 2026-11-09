import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { isAuthorizedHealthCenterUser } from "@/lib/health-center-access";

export const Route = createFileRoute("/api/voice/catalog")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        const auth = context as {
          claims?: { email?: string | null; email_confirmed_at?: string | null };
          guest?: boolean;
        };
        const { getTrustedFishVoices } = await import("@/lib/voice/fish-voice-catalog.server");
        return Response.json(
          {
            voices: await getTrustedFishVoices(),
            canManage: !auth.guest && isAuthorizedHealthCenterUser(auth.claims),
          },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      },
    },
  },
});
