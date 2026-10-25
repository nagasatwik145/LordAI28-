import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/community/creators/$name")({ server: { handlers: { GET: async ({ params }) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ error: "Community is unavailable." }, { status: 503 });
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const slug = decodeURIComponent(params.name).slice(0, 100);
  const { data, error } = await client.from("lord_community_creations").select("slug,creator_slug,creator_name,title,description,category,tags,public_spec,version,helpful_count,published_at").eq("creator_slug", slug).eq("status", "published").eq("moderation_status", "approved").order("published_at", { ascending: false }).limit(60);
  if (error) return Response.json({ error: "Creator profile is unavailable." }, { status: 503 });
  return Response.json({ creator: data?.[0]?.creator_name ?? "LORD Creator", creations: data ?? [] }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
} } } });
