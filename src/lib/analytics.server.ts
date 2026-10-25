import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PRODUCT_EVENTS = [
  "onboarding_started",
  "onboarding_completed",
  "feature_tour_completed",
  "feature_opened",
  "chat_succeeded",
  "chat_failed",
  "study_session_completed",
  "game_generation_succeeded",
  "game_generation_failed",
  "mission_completed",
  "mission_failed",
  "subscription_checkout_initiated",
  "subscription_checkout_confirmed",
] as const;
export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

export function isGrowthAdmin(userId: string): boolean {
  const ids = (process.env.LORD_ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim());
  return ids.includes(userId);
}

export async function recordProductEvent(
  userId: string,
  input: {
    event: ProductEventName;
    feature?: string;
    category?: string;
    durationMs?: number;
    dedupeKey?: string;
  },
) {
  // Analytics tables are created by a migration; generated Supabase types lag migrations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const { data: consent } = await db
    .from("analytics_consents")
    .select("enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (!consent?.enabled) return;
  const { error } = await db.from("product_analytics_events").insert({
    user_id: userId,
    event_name: input.event,
    schema_version: 1,
    dedupe_key: input.dedupeKey,
    feature: input.feature,
    category: input.category,
    duration_ms: input.durationMs,
  });
  if (error?.code === "23505" && input.dedupeKey) return;
  if (error) throw error;
}
