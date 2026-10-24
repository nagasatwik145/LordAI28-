/**
 * Time-based conversation grouping utilities (ChatGPT-style sidebar).
 *
 * Pure, framework-agnostic functions. No React, no DB access. Designed to be
 * memoized with `useMemo` so grouping is computed once per data change rather
 * than on every render.
 *
 * Grouping is based on `last_message_at` in the user's local timezone.
 */

export type ConversationGroupId =
  "pinned" | "favorites" | "today" | "yesterday" | "previous-7-days" | "previous-30-days" | "older";

export interface ConversationGroup {
  id: ConversationGroupId;
  label: string;
  conversations: ConversationRow[];
}

/** Minimal shape required for grouping. Matches the existing `ConversationRow`. */
export interface ConversationRow {
  id: string;
  title: string;
  last_message_at: string;
  /** Pinned conversations render first (ChatGPT-style). */
  pinned?: boolean;
  /** Favorited conversations render second. */
  favorite?: boolean;
  /** Timestamp the conversation was pinned; drives order within the Pinned group. */
  pinned_at?: string | null;
  /** Manual sort key within the same folder (NULL = ordered newest-first). */
  sort_order?: number | null;
}

/** Display order of groups. Used both for sorting output and stable headers. */
export const GROUP_ORDER: ConversationGroupId[] = [
  "pinned",
  "favorites",
  "today",
  "yesterday",
  "previous-7-days",
  "previous-30-days",
  "older",
];

const GROUP_LABELS: Record<ConversationGroupId, string> = {
  pinned: "PINNED",
  favorites: "FAVORITES",
  today: "TODAY",
  yesterday: "YESTERDAY",
  "previous-7-days": "LAST 7 DAYS",
  "previous-30-days": "LAST 30 DAYS",
  older: "OLDER",
};

/**
 * Resolve the local calendar-day boundary (midnight, local time) for a given
 * date. Two timestamps on the same local calendar day produce the same value,
 * which makes "same day" comparisons O(1) and timezone-correct.
 */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Classify a conversation into a time-based group using `last_message_at`.
 *
 * Rules (relative to the current local day, `now`):
 *   today           - same calendar day
 *   yesterday       - previous calendar day
 *   previous-7-days - 2..7 days old
 *   previous-30-days- 8..30 days old
 *   older           - >30 days
 *
 * `pinned` / `favorite` are honored first (future-compatible) and take
 * precedence over the time buckets when set.
 */
export function getConversationGroup(
  conversation: ConversationRow,
  now: Date = new Date(),
): ConversationGroupId {
  if (conversation.pinned) return "pinned";
  if (conversation.favorite) return "favorites";

  const nowDay = startOfLocalDay(now);
  const msgDay = startOfLocalDay(new Date(conversation.last_message_at));

  const dayDiff = Math.round((nowDay - msgDay) / 86_400_000);

  if (dayDiff <= 0) return "today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff <= 7) return "previous-7-days";
  if (dayDiff <= 30) return "previous-30-days";
  return "older";
}

function timeOf(row: ConversationRow): number {
  return new Date(row.last_message_at).getTime();
}

function pinnedAtOf(row: ConversationRow): number {
  if (!row.pinned_at) return 0;
  return new Date(row.pinned_at).getTime();
}

/**
 * Sort a single group's conversations. Within the Pinned section, items are
 * ordered by `pinned_at` (most-recently pinned first); all other groups are
 * ordered newest-first by `last_message_at`. Falls back to `id` for stable
 * ordering when timestamps are identical.
 */
export function sortConversationGroups(conversations: ConversationRow[]): ConversationRow[] {
  return conversations.slice().sort((a, b) => {
    const aPinned = pinnedAtOf(a);
    const bPinned = pinnedAtOf(b);
    if (aPinned !== bPinned) return bPinned - aPinned;
    const aTime = timeOf(a);
    const bTime = timeOf(b);
    if (aTime !== bTime) return bTime - aTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Group conversations into ordered, time-bucketed sections.
 *
 * Performance characteristics:
 *   - Single O(n) pass assigns each conversation to a bucket.
 *   - Each bucket is sorted independently (total sorting cost is O(n log n)).
 *   - Only non-empty groups are emitted, in `GROUP_ORDER`.
 *   - No nested loops over conversations ⇒ strictly no O(n²).
 *
 * @param conversations source list (any order)
 * @param now           reference "now" (defaults to current time); pass a
 *                      stable value from the caller to avoid drift across renders.
 */
export function groupConversations(
  conversations: ConversationRow[],
  now: Date = new Date(),
): ConversationGroup[] {
  const buckets = new Map<ConversationGroupId, ConversationRow[]>();

  for (const conversation of conversations) {
    const group = getConversationGroup(conversation, now);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(conversation);
    else buckets.set(group, [conversation]);
  }

  const groups: ConversationGroup[] = [];
  for (const id of GROUP_ORDER) {
    const bucket = buckets.get(id);
    if (!bucket || bucket.length === 0) continue;
    groups.push({
      id,
      label: GROUP_LABELS[id],
      conversations: sortConversationGroups(bucket),
    });
  }

  return groups;
}

/**
 * Case-insensitive, substring search across conversation titles.
 * Returns a new array; preserves the input order of matches.
 */
export function searchConversations(
  conversations: ConversationRow[],
  query: string,
): ConversationRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return conversations;
  return conversations.filter((c) => c.title.toLowerCase().includes(q));
}

/**
 * Manual ordering for the flat "No Folder" (root) conversation list.
 *
 * When the user has drag-reordered, every root conversation carries a
 * non-null `sort_order`. We then render them in that explicit order. Until the
 * user reorders for the first time, `sort_order` is NULL and we fall back to
 * the familiar newest-first ordering so existing behaviour is unchanged.
 *
 * Design choice: a single manually-ordered root list (no time-section headers)
 * is what makes drag-to-reorder unambiguous and "Notion-like" — there is one
 * obvious place for each item to go. Conversations living inside folders keep
 * their existing per-folder ordering + reparent behaviour.
 *
 * Non-root conversations (folder_id != null) are returned untouched.
 */
export function sortRootConversations<T extends ConversationRow>(conversations: T[]): T[] {
  const hasManualOrder = conversations.some((c) => c.sort_order != null);
  const pinnedFirst = (a: T, b: T): number => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const byPinDate = pinnedAtOf(b) - pinnedAtOf(a);
      if (byPinDate) return byPinDate;
    }
    return 0;
  };
  if (!hasManualOrder) {
    // Legacy / not-yet-ordered: newest-first, stable by id.
    return conversations
      .slice()
      .sort((a, b) => pinnedFirst(a, b) || timeOf(b) - timeOf(a) || (a.id < b.id ? -1 : 1));
  }
  return conversations
    .slice()
    .sort(
      (a, b) =>
        pinnedFirst(a, b) ||
        (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER) ||
        timeOf(b) - timeOf(a) ||
        (a.id < b.id ? -1 : 1),
    );
}

/**
 * Assign contiguous `sort_order` values (0,1,2,…) to the given ordered list of
 * conversation ids. Returns a map id → sort_order ready to persist. Used both by
 * the optimistic cache update and the server write so the two never diverge.
 */
export function buildSortOrderMap(orderedIds: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  orderedIds.forEach((id, i) => {
    map[id] = i;
  });
  return map;
}
