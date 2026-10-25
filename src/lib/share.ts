/**
 * Chat Sharing domain types + URL helpers.
 *
 * Pure, framework-agnostic. No React / Supabase here so it stays trivially
 * testable and reusable from both client and server.
 */

/** Shape of a conversation share row (mirrors the `conversation_shares` table). */
export interface ShareRecord {
  id: string;
  conversation_id: string;
  share_token: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  is_public: boolean;
}

export function isShareToken(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Build the absolute public share URL for a token (works on web + native). */
export function getShareUrl(shareToken: string): string {
  const base =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : (import.meta.env.VITE_APP_URL ?? "");
  return `${base.replace(/\/$/, "")}/share/${shareToken}`;
}

/** A single message in a shared conversation (read-only rendering shape). */
export interface SharedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface SharedConversation {
  title: string;
  created_at: string;
  messages: SharedMessage[];
}
