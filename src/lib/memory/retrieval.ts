/**
 * Semantic memory retrieval.
 *
 * Given a query (the current user turn + recent context) and the user's stored
 * memories, rank by relevance and return only the most useful subset:
 *   • Pinned memories rank first only when they match the current request.
 *   • The rest are ranked by cosine similarity of embeddings.
 *   • A hard cap (MEMORY_RETRIEVAL_LIMIT) and a token budget keep context small
 *     to minimise token usage.
 *   • Unrelated memories (similarity below a floor) are dropped entirely.
 *
 * Works with or without pgvector: when a query embedding is available we rank by
 * it; otherwise we rank by simple keyword overlap as a graceful fallback.
 */

import { embed, cosineSimilarity } from "./embeddings";
import { MEMORY_RETRIEVAL_LIMIT, MEMORY_CONTEXT_TOKEN_BUDGET } from "./constants";
import { isMemoryActive, isSensitive, type MemoryRecord } from "./types";

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export interface RetrievalOptions {
  limit?: number;
  tokenBudget?: number;
  enabled?: boolean;
  /** Drop memories with similarity below this floor (0 disables). */
  minSimilarity?: number;
  /** When true, skip embedding entirely and rank by keyword overlap. */
  lightweight?: boolean;
  projectId?: string | null;
  userId?: string;
}

export interface RetrievedMemory {
  memory: MemoryRecord;
  similarity: number;
}

/**
 * Retrieve the most relevant memories for a query string.
 * Returns memories ordered by relevance; pinned memories float to the top.
 */
export async function retrieveMemories(
  query: string,
  memories: MemoryRecord[],
  options: RetrievalOptions = {},
): Promise<RetrievedMemory[]> {
  const limit = options.limit ?? MEMORY_RETRIEVAL_LIMIT;
  const tokenBudget = options.tokenBudget ?? MEMORY_CONTEXT_TOKEN_BUDGET;
  const minSimilarity = options.minSimilarity ?? 0.08;

  if (options.enabled === false || !query.trim()) return [];
  const eligibleMemories = memories.filter(
    (memory) =>
      memory.confirmation_status !== "suggested" &&
      memory.use_in_context !== false &&
      memory.archived !== true &&
      !isSensitive(memory.content) &&
      (!options.userId || memory.user_id === options.userId) &&
      isMemoryActive(memory.expires_at) &&
      (options.projectId
        ? !memory.project_id || memory.project_id === options.projectId
        : !memory.project_id),
  );
  if (eligibleMemories.length === 0) return [];

  // Compute query embedding once.
  let queryVec: number[] | null = null;
  if (!options.lightweight) {
    try {
      queryVec = (await embed(query)).vector;
    } catch {
      queryVec = null;
    }
  }

  const scored = eligibleMemories
    .map((m) => {
      let similarity: number;
      if (queryVec && m.embedding && m.embedding.length === queryVec.length) {
        similarity = cosineSimilarity(queryVec, m.embedding);
      } else {
        similarity = keywordOverlap(query, m.content);
      }
      const ageDays = Math.max(0, (Date.now() - Date.parse(m.updated_at)) / 86_400_000);
      const recency = Number.isFinite(ageDays) ? 1 / (1 + ageDays / 90) : 0;
      return {
        memory: m,
        similarity: similarity * 0.85 + recency * 0.05,
        rawSimilarity: similarity,
      };
    })
    .filter((r) => r.rawSimilarity >= minSimilarity);

  scored.sort(
    (a, b) => Number(b.memory.pinned) - Number(a.memory.pinned) || b.similarity - a.similarity,
  );

  // Build the result within token budget: pinned first, then most relevant.
  const result: RetrievedMemory[] = [];
  let used = 0;

  for (const r of scored) {
    if (result.length >= limit) break;
    const cost = estimateTokens(r.memory.content) + 8;
    if (used + cost > tokenBudget) continue;
    result.push({ memory: r.memory, similarity: r.rawSimilarity });
    used += cost;
  }

  return result;
}

function keywordOverlap(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / Math.sqrt(sa.size * sb.size);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}
