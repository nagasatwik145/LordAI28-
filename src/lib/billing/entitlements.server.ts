import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type VerifiedIdentity = { id: string; email?: string; email_confirmed_at?: string | null };

export const LORD_PRO_ENABLED = true;

const LIFETIME_EMAILS = new Set([
  "nagasatwik145@gmail.com",
  "djahnavi451@gmail.com",
  "inf1nity3smart@gmail.com",
]);

/** Env entries are immutable Supabase UUID=email pairs. Email alone never grants access. */
export function hasConfiguredLifetimeIdentity(user: VerifiedIdentity): boolean {
  if (!user.email || !user.email_confirmed_at) return false;
  const email = user.email.trim().toLowerCase();
  if (!LIFETIME_EMAILS.has(email)) return false;
  const entries = (process.env.LORD_LIFETIME_PRO_USERS ?? "").split(",");
  return entries.some((entry) => {
    const [id, configuredEmail] = entry.trim().split(":");
    return id === user.id && configuredEmail?.toLowerCase() === email;
  });
}

export function isEntitlementActive(
  status: string | undefined,
  expiresAt: string | null | undefined,
  now = Date.now(),
): boolean {
  return (
    (status === "active" || status === "cancelled") &&
    Boolean(expiresAt) &&
    Date.parse(expiresAt!) > now
  );
}

export async function hasProEntitlement(user: VerifiedIdentity): Promise<boolean> {
  if (hasConfiguredLifetimeIdentity(user)) return LORD_PRO_ENABLED;
  if (!user.email_confirmed_at) return false;
  const { data, error } = await supabaseAdmin
    .from("pro_entitlements")
    .select("status,expires_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (data?.status === "active" && data.expires_at && Date.parse(data.expires_at) <= Date.now()) {
    const { error: expiryError } = await supabaseAdmin
      .from("pro_entitlements")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("status", "active");
    if (expiryError) throw expiryError;
  }
  return LORD_PRO_ENABLED && isEntitlementActive(data?.status, data?.expires_at);
}
