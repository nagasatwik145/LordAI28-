/* eslint-disable @typescript-eslint/no-explicit-any -- legacy knowledge graph tables are not represented in generated Supabase types. */
import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";

// Deterministic indexing deliberately proposes only terms present in the source.
const STOP = new Set(
  "about after again also and are because been before being between could does doing down each from further have into just more most other over same some than that the their then there these they this those through under until very what when where which while with would your project conversation memory note user assistant".split(
    " ",
  ),
);
const termsIn = (text: string) =>
  [
    ...new Set(
      (text.match(/[A-Za-z][A-Za-z0-9+#.-]{2,}/g) ?? [])
        .filter((word) => !STOP.has(word.toLowerCase()))
        .filter((word) => /^[A-Z][a-z]+(?:[- ][A-Z][a-z]+)*$/.test(word) || word.length >= 5)
        .map((word) => word.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);

export const Route = createFileRoute("/api/knowledge-graph")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ context, request }) => {
        const { userId, supabase } = context as { userId?: string; supabase?: any };
        if (!userId || !supabase) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const body = (await request.json().catch(() => null)) as {
          action?: string;
          query?: string;
          entityId?: string;
          status?: string;
        } | null;
        if (body?.action === "index") {
          const [memories, conversations, sources] = await Promise.all([
            supabase
              .from("memories")
              .select("id,content,created_at")
              .eq("user_id", userId)
              .eq("archived", false)
              .order("created_at", { ascending: false })
              .limit(100),
            supabase
              .from("conversations")
              .select("id,title,created_at")
              .eq("user_id", userId)
              .eq("archived", false)
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
              .limit(100),
            supabase
              .from("knowledge_sources")
              .select("id,name,created_at")
              .eq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(100),
          ]);
          const failed = [memories, conversations, sources].find((result) => result.error);
          if (failed)
            return Response.json(
              { error: "Could not load authorized sources for indexing." },
              { status: 500 },
            );
          const records = [
            ...(memories.data ?? []).map((r: any) => ({
              id: r.id,
              kind: "memory",
              text: r.content,
            })),
            ...(conversations.data ?? [])
              .filter((r: any) => r.title)
              .map((r: any) => ({ id: r.id, kind: "conversation", text: r.title })),
            ...(sources.data ?? []).map((r: any) => ({ id: r.id, kind: "document", text: r.name })),
          ];
          let indexed = 0;
          for (const record of records)
            for (const name of termsIn(record.text)) {
              const normalized = name.toLowerCase().replace(/\s+/g, " ").trim();
              const existing = await supabase
                .from("knowledge_entities")
                .select("id")
                .eq("user_id", userId)
                .eq("source_type", record.kind)
                .eq("source_identifier", record.id)
                .eq("normalized_name", normalized)
                .maybeSingle();
              if (existing.error)
                return Response.json({ error: "Indexing failed." }, { status: 500 });
              if (existing.data) continue;
              const inserted = await supabase.from("knowledge_entities").insert({
                user_id: userId,
                type: "concept",
                name,
                normalized_name: normalized,
                description: `Mentioned in ${record.kind}`,
                source_type: record.kind,
                source_identifier: record.id,
                extracted_at: new Date().toISOString(),
                review_status: "pending",
                metadata: { extraction: "deterministic_term_match" },
              });
              if (inserted.error && inserted.error.code !== "23505")
                return Response.json({ error: "Indexing failed." }, { status: 500 });
              if (!inserted.error) indexed++;
            }
          return Response.json({ indexed, sources: records.length });
        }
        if (body?.action === "search") {
          const query = typeof body.query === "string" ? body.query.trim().slice(0, 120) : "";
          if (!query) return Response.json({ results: [] });
          const { data, error } = await supabase
            .from("knowledge_entities")
            .select(
              "id,type,name,description,source_type,source_identifier,review_status,created_at",
            )
            .eq("user_id", userId)
            .eq("review_status", "approved")
            .ilike("name", `%${query.replace(/[%_,]/g, " ")}%`)
            .order("created_at", { ascending: false })
            .limit(20);
          if (error) return Response.json({ error: "Search failed." }, { status: 500 });
          return Response.json({ results: data ?? [] });
        }
        if (body?.action === "list_pending") {
          const { data, error } = await supabase
            .from("knowledge_entities")
            .select("id,name,source_type,source_identifier,created_at")
            .eq("user_id", userId)
            .eq("review_status", "pending")
            .order("created_at", { ascending: false })
            .limit(100);
          if (error)
            return Response.json({ error: "Could not load suggestions." }, { status: 500 });
          return Response.json({ suggestions: data ?? [] });
        }
        if (body?.action === "review" || body?.action === "delete") {
          if (typeof body.entityId !== "string") {
            return Response.json({ error: "entityId is required." }, { status: 400 });
          }
          let query = supabase.from("knowledge_entities");
          query =
            body.action === "delete"
              ? query.delete().eq("id", body.entityId).eq("user_id", userId)
              : query
                  .update({
                    review_status: body.status === "approved" ? "approved" : "dismissed",
                  })
                  .eq("id", body.entityId)
                  .eq("user_id", userId);
          query = query.select("id").maybeSingle();
          const { data, error } = await query;
          if (error)
            return Response.json({ error: "Could not update suggestion." }, { status: 500 });
          return Response.json({ updated: Boolean(data) });
        }
        return Response.json({ error: "Use action=index or action=search." }, { status: 400 });
      },
    },
  },
});
