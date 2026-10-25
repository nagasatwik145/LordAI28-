import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { apiErrorResponse } from "@/lib/api-error";
import type { Database } from "@/integrations/supabase/types";
import { isShareToken, type SharedConversation, type SharedMessage } from "@/lib/share";

const requestId = () => crypto.randomUUID();

/**
 * Public, read-only accessor for a shared conversation. NO authentication:
 * anyone with a valid, non-expired, public share token can read it. All
 * ownership / expiry / public checks happen inside the SECURITY DEFINER
 * function `get_shared_conversation`, which returns ONLY the title + messages
 * (never user_id, email, or any PII). A missing / expired / non-public token
 * yields no rows, which we map to 404 to avoid leaking whether a token exists.
 */
export const Route = createFileRoute("/api/shared/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const rid = requestId();
        const token = params.token;
        if (!isShareToken(token)) {
          return apiErrorResponse(
            404,
            "NOT_FOUND",
            "This shared conversation is unavailable.",
            rid,
          );
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY =
          process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return apiErrorResponse(503, "INTERNAL_ERROR", "Sharing is not configured.", rid);
        }

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data, error } = await supabase.rpc("get_shared_conversation", {
          share_token: token,
        });
        if (error) {
          return apiErrorResponse(
            500,
            "INTERNAL_ERROR",
            "Could not load shared conversation.",
            rid,
          );
        }

        const rows = (data ?? []) as Array<{
          title: string;
          created_at: string;
          message_id: string;
          role: string;
          content: string;
          message_created_at: string;
        }>;

        // No rows → token invalid / expired / private. Return 404 uniformly so
        // callers cannot distinguish these cases (anti-enumeration).
        if (rows.length === 0) {
          return apiErrorResponse(
            404,
            "NOT_FOUND",
            "This shared conversation is unavailable.",
            rid,
          );
        }

        const messages: SharedMessage[] = rows.map((r) => ({
          id: r.message_id,
          role: r.role === "assistant" ? "assistant" : r.role === "system" ? "system" : "user",
          content: r.content,
          created_at: r.message_created_at,
        }));

        const shared: SharedConversation = {
          title: rows[0].title,
          created_at: rows[0].created_at,
          messages,
        };

        return Response.json(
          { conversation: shared },
          { headers: { "Cache-Control": "public, max-age=30" } },
        );
      },
    },
  },
});
