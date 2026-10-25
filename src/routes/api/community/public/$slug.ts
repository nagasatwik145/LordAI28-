import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/community/public/$slug")({
  server: { handlers: { GET: async ({ params }) => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return Response.json({ error: "Community is unavailable." }, { status: 503 });
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.from("lord_community_creations").select("slug,creator_slug,creator_name,title,description,category,tags,public_spec,version,helpful_count,published_at").eq("slug", params.slug).eq("status", "published").eq("moderation_status", "approved").maybeSingle();
    if (error || !data) return Response.json({ error: "This creation is unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ creation: data }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
  } } },
});
