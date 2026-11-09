export const AUTHORIZED_HEALTH_CENTER_EMAIL = "nagasatwik145@gmail.com";

export function normalizeHealthCenterEmail(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  return normalized || null;
}

export function isAuthorizedHealthCenterUser(
  user:
    | {
        email?: string | null;
        email_confirmed_at?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!user?.email_confirmed_at) return false;
  return normalizeHealthCenterEmail(user.email) === AUTHORIZED_HEALTH_CENTER_EMAIL;
}
