/**
 * Core types & constants for the LORD AI Long-Term Memory system.
 *
 * The system is designed to feel like ChatGPT Memory:
 *   • Three primary user-facing categories (profile, preference, fact) plus
 *     "project" for ongoing work and "note" as a generic fallback.
 *   • Every auto-detected memory carries a `confidence` score (0..1). Memories
 *     above the user's threshold are auto-saved; lower ones are surfaced for the
 *     user to confirm.
 *   • Sensitive data is never stored (see `isSensitive`).
 */

export type MemoryCategory = "profile" | "preference" | "fact" | "project" | "note";

/** The three canonical categories required by the product spec. */
export const PRIMARY_CATEGORIES: MemoryCategory[] = ["profile", "preference", "fact"];

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "profile",
  "preference",
  "fact",
  "project",
  "note",
];

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: "Profile",
  preference: "Preferences",
  fact: "Long-Term Facts",
  project: "Projects",
  note: "Notes",
};

export const MEMORY_CATEGORY_DESCRIPTIONS: Record<MemoryCategory, string> = {
  profile: "Who you are — name, location, school, grade.",
  preference: "How you like LORD to behave and respond.",
  fact: "Durable facts about your life and work.",
  project: "Ongoing projects, goals and learning progress.",
  note: "Anything else worth remembering.",
};

export type MemorySource = "auto" | "manual" | "imported";

export interface MemoryRecord {
  id: string;
  user_id: string;
  content: string;
  category: MemoryCategory;
  pinned: boolean;
  confidence: number;
  source: MemorySource;
  embedding: number[] | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
  project_id?: string | null;
  source_conversation_id?: string | null;
  confirmation_status?: "suggested" | "confirmed";
  use_in_context?: boolean;
  archived?: boolean | null;
}

export interface MemorySettings {
  user_id: string;
  memory_enabled: boolean;
  personalization_enabled: boolean;
  auto_save: boolean;
  ask_before_save: boolean;
  confidence_threshold: number;
  updated_at: string;
}

export function isMemoryEnabled(
  settings: Pick<MemorySettings, "memory_enabled"> | null | undefined,
): boolean {
  return settings?.memory_enabled ?? true;
}

export function isMemoryActive(expiresAt: string | null | undefined, now = Date.now()): boolean {
  return !expiresAt || Date.parse(expiresAt) > now;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  user_id: "",
  memory_enabled: true,
  personalization_enabled: true,
  auto_save: true,
  ask_before_save: true,
  confidence_threshold: 0.65,
  updated_at: new Date().toISOString(),
};

/** A memory detected from a user message, before it is persisted. */
export interface DetectedMemory {
  content: string;
  category: MemoryCategory;
  confidence: number;
  expiresAt?: string;
  /** Short human explanation used when asking the user to confirm. */
  reason: string;
  sourceConversationId?: string;
}

/**
 * Patterns that indicate information that must NEVER be stored:
 * passwords, API keys, secrets, auth tokens, payment info, and other highly
 * sensitive personal data. Detection is conservative — when in doubt we refuse.
 */
const SENSITIVE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "password", re: /\b(password|passwd|pwd)\b/i },
  { label: "api key", re: /\b(api[_\- ]?key|apikey|secret[_\- ]?key|access[_\- ]?token)\b/i },
  { label: "token", re: /\b(token|bearer)\b/i },
  { label: "private key", re: /\b(private[_\- ]?key|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY)\b/i },
  { label: "card number", re: /\b(?:card|cardnumber|card number|ccn|cvv|cvv2)\b/i },
  { label: "ssn", re: /\b(ssn|social security)\b/i },
  { label: "otp", re: /\b(otp|one[ -]time[ -]?password|verification code)\b/i },
  { label: "credential", re: /\b(credentials?|login (and|&) password)\b/i },
];

/**
 * Returns the matched sensitive category label, or null if the text is safe to
 * remember. Used both by the detector (to skip) and as a guard before persist.
 */
export function detectSensitive(text: string): string | null {
  for (const { label, re } of SENSITIVE_PATTERNS) {
    if (re.test(text)) return label;
  }
  // Also flag raw secrets: long alphanumeric strings that look like tokens.
  const looksLikeSecret = /\b[a-z0-9]{32,}\b/i.test(text) || /\b[A-Za-z0-9_-]{40,}\b/.test(text);
  if (looksLikeSecret && /\b(sk|pk|key|token|secret)\b/i.test(text)) return "secret";
  return null;
}

export function isSensitive(text: string): boolean {
  return detectSensitive(text) !== null;
}
