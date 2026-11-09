import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireHealthCenterAdmin } from "@/integrations/supabase/auth-middleware";
import { LORD_DEFAULT_VOICE_ID, isFishVoiceIdFormat } from "@/lib/voice/fish-voice-catalog";
import type { FishVoiceCategory } from "@/lib/voice/fish-voice-catalog";

const CategorySchema = z.enum(["assistant", "feminine", "masculine", "character", "other"]);
const AddVoiceSchema = z.object({
  id: z
    .string()
    .trim()
    .refine(isFishVoiceIdFormat)
    .transform((id) => id.toLowerCase()),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  category: CategorySchema,
});
const DeleteVoiceSchema = z.object({
  id: z
    .string()
    .trim()
    .refine(isFishVoiceIdFormat)
    .transform((id) => id.toLowerCase()),
});

export const Route = createFileRoute("/api/voice/catalog/manage")({
  server: {
    middleware: [requireHealthCenterAdmin],
    handlers: {
      POST: async ({ request }) => {
        const parsed = AddVoiceSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "Invalid voice details." }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("fish_voice_catalog")
          .insert({
            ...parsed.data,
            category: parsed.data.category as FishVoiceCategory,
            is_default: false,
          })
          .select("id, name, description, category, is_default")
          .single();
        if (error) {
          const duplicate = error.code === "23505";
          return Response.json(
            {
              error: duplicate
                ? "That Fish Audio voice ID is already in the catalog."
                : "Could not add voice.",
            },
            { status: duplicate ? 409 : 500 },
          );
        }
        return Response.json(
          { voice: data },
          { status: 201, headers: { "Cache-Control": "no-store" } },
        );
      },
      DELETE: async ({ request }) => {
        const parsed = DeleteVoiceSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "A valid voice ID is required." }, { status: 400 });
        if (parsed.data.id === LORD_DEFAULT_VOICE_ID) {
          return Response.json(
            { error: "The LORD default voice cannot be removed." },
            { status: 400 },
          );
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("fish_voice_catalog")
          .delete()
          .eq("id", parsed.data.id)
          .eq("is_default", false)
          .select("id")
          .maybeSingle();
        if (error) return Response.json({ error: "Could not remove voice." }, { status: 500 });
        if (!data) return Response.json({ error: "Voice was not found." }, { status: 404 });
        return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
