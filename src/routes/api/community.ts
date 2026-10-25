import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { validateGameSpec } from "@/lib/games/game-runtime";
import { hasProEntitlement } from "@/lib/billing/entitlements.server";

const categories = ["games", "agents", "templates", "learning"] as const;
const inputSchema = z.object({
  action: z.enum(["create", "update", "unpublish", "delete", "vote", "bookmark", "report", "moderate"]),
  id: z.string().uuid().optional(), sourceId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(100).optional(), description: z.string().trim().min(10).max(2000).optional(),
  category: z.enum(categories).optional(), tags: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  status: z.enum(["draft", "published"]).optional(), reason: z.enum(["spam", "harmful", "copyright", "privacy", "other"]).optional(),
  details: z.string().trim().max(1000).optional(), reportedUserId: z.union([z.string().uuid(), z.literal("creator")]).optional(), moderationStatus: z.enum(["approved", "rejected", "removed"]).optional(),
  reportStatus: z.enum(["reviewing", "resolved", "dismissed"]).optional(), reportId: z.string().uuid().optional(),
});
const safeText = (s: string) => s.replace(/[<>\u0000-\u001f]/g, "").trim();
const slugify = (s: string) => `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64)}-${crypto.randomUUID().slice(0, 8)}`;

export const Route = createFileRoute("/api/community")({
  server: { middleware: [requireSupabaseRequestAuth], handlers: {
    GET: async ({ request, context }) => {
      const { supabase, userId } = context as { supabase: any; userId: string };
      const url = new URL(request.url);
      const own = url.searchParams.get("own") === "1";
      const moderators = (process.env.LORD_COMMUNITY_MODERATOR_IDS ?? "").split(",").map(v => v.trim()).filter(Boolean);
      if (url.searchParams.get("moderation") === "1" && moderators.includes(userId)) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as any;
        const { data: creations } = await admin.from("lord_community_creations").select("id,title,creator_name,moderation_status,status,created_at").eq("moderation_status", "pending").order("created_at", { ascending: true }).limit(100);
        const { data: reports } = await admin.from("lord_community_reports").select("id,creation_id,reported_user_id,reason,details,status,created_at").eq("status", "open").order("created_at", { ascending: true }).limit(100);
        return Response.json({ moderator: true, creations: creations ?? [], reports: reports ?? [] });
      }
      let query = supabase.from("lord_community_creations").select("id,slug,creator_slug,creator_name,source_type,source_id,title,description,category,tags,public_spec,version,status,moderation_status,helpful_count,created_at,updated_at,published_at");
      if (own) query = query.eq("creator_id", userId).order("updated_at", { ascending: false });
      else {
        query = query.eq("status", "published").eq("moderation_status", "approved");
        const category = url.searchParams.get("category");
        const search = url.searchParams.get("q");
        if (category && categories.includes(category as typeof categories[number])) query = query.eq("category", category);
        if (search) query = query.or(`title.ilike.%${search.replace(/[%_,]/g, " ").slice(0, 80)}%,description.ilike.%${search.replace(/[%_,]/g, " ").slice(0, 80)}%`);
        query = query.order("published_at", { ascending: false }).limit(60);
      }
      const { data, error } = await query;
      if (error) return Response.json({ error: "Community content is unavailable." }, { status: 503 });
      const { data: votes } = await supabase.from("lord_community_votes").select("creation_id").eq("user_id", userId);
      const { data: bookmarks } = await supabase.from("lord_community_bookmarks").select("creation_id").eq("user_id", userId);
      return Response.json({ creations: data ?? [], voted: (votes ?? []).map((v: { creation_id: string }) => v.creation_id), bookmarked: (bookmarks ?? []).map((v: { creation_id: string }) => v.creation_id) });
    },
    POST: async ({ request, context }) => {
      const { supabase, userId, claims } = context as { supabase: any; userId: string; claims: any };
      let raw: unknown;
      try { raw = await request.json(); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) return Response.json({ error: "Invalid community request." }, { status: 400 });
      const input = parsed.data;
      const moderators = (process.env.LORD_COMMUNITY_MODERATOR_IDS ?? "").split(",").map(v => v.trim()).filter(Boolean);
      if (input.action === "moderate" && !moderators.includes(userId)) return Response.json({ error: "Moderator access required." }, { status: 403 });
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as any;
      const ownEntry = async () => {
        if (!input.id) return null;
        const { data } = await admin.from("lord_community_creations").select("*").eq("id", input.id).eq("creator_id", userId).maybeSingle();
        return data;
      };
      if (input.action === "create") {
        if (!input.sourceId || !input.title || !input.description || !input.category || !input.status) return Response.json({ error: "Complete all publishing fields." }, { status: 400 });
        const { count } = await admin.from("lord_community_creations").select("id", { count: "exact", head: true }).eq("creator_id", userId).gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
        if ((count ?? 0) >= 5) return Response.json({ error: "Publishing limit reached. Try again later." }, { status: 429 });
        const { data: game } = await supabase.from("ai_games").select("id,spec,status").eq("id", input.sourceId).eq("user_id", userId).maybeSingle();
        if (!game || (game.status && game.status !== "ready") || !validateGameSpec(game.spec)) return Response.json({ error: "That saved game is unavailable or invalid." }, { status: 400 });
        if ((game.spec as { schemaVersion?: number }).schemaVersion === 3 && !(await hasProEntitlement({ id: userId, ...claims }))) return Response.json({ error: "This 3D game requires LORD Pro." }, { status: 403 });
        const { data: profile } = await supabase.from("profiles").select("name").eq("id", userId).maybeSingle();
        const creatorName = safeText(profile?.name || claims?.user_metadata?.name || "LORD Creator").slice(0, 80) || "LORD Creator";
        const { data: existingCreator } = await admin.from("lord_community_creations").select("creator_slug").eq("creator_id", userId).limit(1).maybeSingle();
        const creatorSlug = existingCreator?.creator_slug ?? `creator-${crypto.randomUUID()}`;
        const { data, error } = await admin.from("lord_community_creations").insert({ creator_id: userId, creator_slug: creatorSlug, creator_name: creatorName, source_type: "game", source_id: game.id, public_spec: game.spec, title: safeText(input.title), description: safeText(input.description), category: input.category, tags: (input.tags ?? []).map(safeText).slice(0, 8), slug: slugify(input.title), status: input.status, moderation_status: "pending", published_at: input.status === "published" ? new Date().toISOString() : null }).select().single();
        if (error) return Response.json({ error: "Could not save this creation." }, { status: 500 });
        return Response.json({ creation: data }, { status: 201 });
      }
      if (input.action === "report") {
        if (!input.reason || (!input.id && !input.reportedUserId)) return Response.json({ error: "Choose a report reason and target." }, { status: 400 });
        const { count } = await admin.from("lord_community_reports").select("id", { count: "exact", head: true }).eq("reporter_id", userId).gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
        if ((count ?? 0) >= 5) return Response.json({ error: "Report limit reached. Try again later." }, { status: 429 });
        let reportedUserId = input.reportedUserId ?? null;
        let creationId = input.id ?? null;
        if (input.id && input.reportedUserId === "creator") {
          const { data: target } = await admin.from("lord_community_creations").select("creator_id").eq("id", input.id).maybeSingle();
          if (!target || target.creator_id === userId) return Response.json({ error: "Creator is unavailable." }, { status: 404 });
          reportedUserId = target.creator_id;
          creationId = null;
        }
        const { error } = await admin.from("lord_community_reports").insert({ reporter_id: userId, creation_id: creationId, reported_user_id: reportedUserId, reason: input.reason, details: safeText(input.details ?? "") });
        return error ? Response.json({ error: "Could not submit report." }, { status: 500 }) : Response.json({ ok: true });
      }
      if (input.action === "vote") {
        if (!input.id) return Response.json({ error: "Creation required." }, { status: 400 });
        const { error } = await supabase.from("lord_community_votes").insert({ creation_id: input.id, user_id: userId });
        return error ? Response.json({ error: "You may already have voted, or this creation is unavailable." }, { status: 409 }) : Response.json({ ok: true });
      }
      if (input.action === "bookmark") {
        if (!input.id) return Response.json({ error: "Creation required." }, { status: 400 });
        const { data: existing } = await supabase.from("lord_community_bookmarks").select("creation_id").eq("creation_id", input.id).eq("user_id", userId).maybeSingle();
        const result = existing
          ? await supabase.from("lord_community_bookmarks").delete().eq("creation_id", input.id).eq("user_id", userId)
          : await supabase.from("lord_community_bookmarks").insert({ creation_id: input.id, user_id: userId });
        return result.error ? Response.json({ error: "Could not update bookmark." }, { status: 409 }) : Response.json({ ok: true, bookmarked: !existing });
      }
      if (input.action === "moderate") {
        if (input.reportId && input.reportStatus) {
          const { error } = await admin.from("lord_community_reports").update({ status: input.reportStatus }).eq("id", input.reportId);
          return error ? Response.json({ error: "Report review update failed." }, { status: 500 }) : Response.json({ ok: true });
        }
        if (!input.id || !input.moderationStatus) return Response.json({ error: "Moderation decision required." }, { status: 400 });
        const { error } = await admin.from("lord_community_creations").update({ moderation_status: input.moderationStatus, status: input.moderationStatus === "removed" ? "removed" : undefined }).eq("id", input.id);
        return error ? Response.json({ error: "Moderation update failed." }, { status: 500 }) : Response.json({ ok: true });
      }
      const entry = await ownEntry();
      if (!entry) return Response.json({ error: "Creation not found." }, { status: 404 });
      if (input.action === "delete") {
        const { error } = await admin.from("lord_community_creations").delete().eq("id", entry.id).eq("creator_id", userId);
        return error ? Response.json({ error: "Could not delete creation." }, { status: 500 }) : Response.json({ ok: true });
      }
      const patch: Record<string, unknown> = {};
      if (input.title) patch.title = safeText(input.title);
      if (input.description) patch.description = safeText(input.description);
      if (input.category) patch.category = input.category;
      if (input.tags) patch.tags = input.tags.map(safeText);
      if (input.action === "unpublish") { patch.status = "unpublished"; patch.published_at = null; }
      if (input.action === "update" && input.status) {
        if (input.status === "published" && entry.status !== "published") {
          const { count } = await admin.from("lord_community_creations").select("id", { count: "exact", head: true }).eq("creator_id", userId).gte("updated_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
          if ((count ?? 0) >= 5) return Response.json({ error: "Publishing limit reached. Try again later." }, { status: 429 });
        }
        patch.status = input.status;
        patch.published_at = input.status === "published" ? new Date().toISOString() : null;
      }
      if ((input.title || input.description || input.tags || input.category) && entry.status === "published") patch.moderation_status = "pending";
      const { data, error } = await admin.from("lord_community_creations").update(patch).eq("id", entry.id).eq("creator_id", userId).select().single();
      return error ? Response.json({ error: "Could not update creation." }, { status: 500 }) : Response.json({ creation: data });
    },
  } },
});
