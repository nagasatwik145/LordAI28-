/**
 * Reusable memory service: React Query hooks + Supabase-backed CRUD that the
 * chat experience, the Memory Dashboard, and the Settings page all share.
 *
 * Design notes (mirrors the existing chat/real-time conventions in this repo):
 *   • Every mutation updates the React Query cache OPTIMISTICALLY first, snaps
 *     the previous value for rollback, then reconciles with the server.
 *   • `client_tag` is stamped on writes so the shared RealtimeManager can
 *     suppress self-echoes (see lib/realtime/client-tag.ts).
 *   • All reads are scoped to the current user; RLS enforces this server-side,
 *     and the cache key includes the user id for extra safety.
 *   • Embeddings are computed lazily on write so retrieval can rank by semantic
 *     similarity without blocking the UI.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createClientTag, markClientTagSent } from "@/lib/realtime/client-tag";
import {
  DEFAULT_MEMORY_SETTINGS,
  isSensitive,
  type DetectedMemory,
  type MemoryCategory,
  type MemoryRecord,
  type MemorySettings,
  type MemorySource,
} from "./types";
import { embed } from "./embeddings";
import { arePossibleDuplicates } from "./graph";
import { invalidateBrainContextCache } from "@/lib/brain/context-cache";
import type { Database } from "@/integrations/supabase/types";

export const MEMORIES_KEY = (userId: string | null | undefined) =>
  ["memories", userId ?? "anon"] as const;

export const MEMORY_SETTINGS_KEY = (userId: string | null | undefined) =>
  ["memory_settings", userId ?? "anon"] as const;

// ---- Types that map DB rows to our MemoryRecord ----------------------------
type DbMemoryRow = {
  id: string;
  user_id: string;
  content: string;
  category: string;
  pinned: boolean;
  confidence: number;
  source: string;
  embedding: unknown | null; // jsonb -> unknown
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
  project_id?: string | null;
  source_conversation_id?: string | null;
  confirmation_status?: "suggested" | "confirmed";
  use_in_context?: boolean;
  archived?: boolean | null;
};

function rowToMemory(row: DbMemoryRow): MemoryRecord {
  let embedding: number[] | null = null;
  if (Array.isArray(row.embedding)) {
    embedding = row.embedding as number[];
  } else if (
    row.embedding &&
    typeof row.embedding === "object" &&
    "vector" in (row.embedding as object)
  ) {
    embedding = (row.embedding as { vector: number[] }).vector ?? null;
  }
  return {
    id: row.id,
    user_id: row.user_id,
    content: row.content,
    category: (row.category as MemoryCategory) ?? "note",
    pinned: row.pinned,
    confidence: typeof row.confidence === "number" ? row.confidence : 1,
    source: (row.source as MemorySource) ?? "manual",
    embedding,
    expires_at: row.expires_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    project_id: row.project_id ?? null,
    source_conversation_id: row.source_conversation_id ?? null,
    confirmation_status: row.confirmation_status ?? "confirmed",
    use_in_context: row.use_in_context ?? true,
    archived: row.archived ?? false,
  };
}

// ---- Queries ---------------------------------------------------------------
export function useMemories(userId: string | null | undefined) {
  return useQuery({
    queryKey: MEMORIES_KEY(userId),
    enabled: !!userId,
    queryFn: async (): Promise<MemoryRecord[]> => {
      const { data, error } = await supabase
        .from("memories")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as DbMemoryRow[]).map(rowToMemory);
    },
  });
}

export function useMemorySettings(userId: string | null | undefined) {
  return useQuery({
    queryKey: MEMORY_SETTINGS_KEY(userId),
    enabled: !!userId,
    queryFn: async (): Promise<MemorySettings> => {
      const { data, error } = await supabase
        .from("memory_settings")
        .select("*")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error && error.code !== "PGRST116") throw error;
      if (!data) {
        return { ...DEFAULT_MEMORY_SETTINGS, user_id: userId! };
      }
      return data as MemorySettings;
    },
  });
}

// ---- Mutations -------------------------------------------------------------
// Helper to update the memories cache immutably.
function patchMemoriesCache(
  qc: ReturnType<typeof useQueryClient>,
  userId: string,
  fn: (old: MemoryRecord[]) => MemoryRecord[],
) {
  qc.setQueryData<MemoryRecord[]>(MEMORIES_KEY(userId), (old) => fn(old ?? []));
}

/** Insert a memory (used by manual add and by auto-detection). */
export function useAddMemory(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      content: string;
      category: MemoryCategory;
      confidence?: number;
      source?: MemorySource;
      expiresAt?: string;
      projectId?: string | null;
      sourceConversationId?: string | null;
      confirmationStatus?: "suggested" | "confirmed";
      useInContext?: boolean;
    }) => {
      if (!userId) throw new Error("Not authenticated");
      const content = input.content.trim();
      if (!content) throw new Error("Memory cannot be empty");
      if (isSensitive(content)) throw new Error("That looks like a secret. Not saved.");

      let projectId = input.projectId ?? null;
      if (!projectId && input.sourceConversationId) {
        const { data: conversation, error: conversationError } = await supabase
          .from("conversations")
          .select("project_id")
          .eq("id", input.sourceConversationId)
          .eq("user_id", userId)
          .maybeSingle();
        if (conversationError) throw conversationError;
        projectId = conversation?.project_id ?? null;
      }

      let existingQuery = supabase.from("memories").select("*").eq("user_id", userId);
      existingQuery = projectId
        ? existingQuery.eq("project_id", projectId)
        : existingQuery.is("project_id", null);
      const { data: existingMemories, error: existingError } = await existingQuery;
      if (existingError) throw existingError;
      const duplicate = ((existingMemories ?? []) as DbMemoryRow[]).find((memory) =>
        arePossibleDuplicates(memory.content, content),
      );
      if (duplicate) return rowToMemory(duplicate);

      let embedding: number[] | null = null;
      try {
        embedding = (await embed(content)).vector;
      } catch {
        embedding = null;
      }

      const tag = createClientTag();
      markClientTagSent(tag);
      const insertValues: Database["public"]["Tables"]["memories"]["Insert"] = {
        user_id: userId,
        content,
        category: input.category,
        confidence: input.confidence ?? 1,
        source: input.source ?? "manual",
        embedding,
        expires_at: input.expiresAt ?? null,
        client_tag: tag,
        project_id: projectId,
        source_conversation_id: input.sourceConversationId ?? null,
        confirmation_status:
          input.confirmationStatus ?? (input.source === "auto" ? "suggested" : "confirmed"),
        use_in_context: input.useInContext ?? input.source !== "auto",
      };
      const { data, error } = await supabase
        .from("memories")
        .insert(insertValues)
        .select()
        .single();
      if (error) throw error;
      invalidateBrainContextCache(userId);
      return rowToMemory(data as DbMemoryRow);
    },
    onMutate: async (input) => {
      if (!userId) return;
      await qc.cancelQueries({ queryKey: MEMORIES_KEY(userId) });
      const previous = qc.getQueryData<MemoryRecord[]>(MEMORIES_KEY(userId));
      const optimistic: MemoryRecord = {
        id: `temp-${createClientTag()}`,
        user_id: userId,
        content: input.content.trim(),
        category: input.category,
        pinned: false,
        confidence: input.confidence ?? 1,
        source: input.source ?? "manual",
        embedding: null,
        expires_at: input.expiresAt ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        project_id: input.projectId ?? null,
        source_conversation_id: input.sourceConversationId ?? null,
        confirmation_status:
          input.confirmationStatus ?? (input.source === "auto" ? "suggested" : "confirmed"),
        use_in_context: input.useInContext ?? input.source !== "auto",
      };
      patchMemoriesCache(qc, userId, (old) => [optimistic, ...old]);
      return { previous, optimisticId: optimistic.id };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId) {
        qc.setQueryData(MEMORIES_KEY(userId), context.previous);
      }
    },
    onSuccess: (saved, _input, context) => {
      if (!userId) return;
      patchMemoriesCache(qc, userId, (old) =>
        old.map((m) => (m.id === context?.optimisticId ? saved : m)),
      );
    },
    onSettled: () => {
      if (userId) qc.invalidateQueries({ queryKey: MEMORIES_KEY(userId) });
    },
  });
}

/** Persist a detected memory (auto path). Returns the saved record. */
export function useSaveDetectedMemory(userId: string | null | undefined) {
  const add = useAddMemory(userId);
  return useMutation({
    mutationFn: async (detected: DetectedMemory) =>
      add.mutateAsync({
        content: detected.content,
        category: detected.category,
        confidence: detected.confidence,
        source: "auto",
        expiresAt: detected.expiresAt,
        sourceConversationId: detected.sourceConversationId,
        confirmationStatus: "confirmed",
        useInContext: true,
      }),
  });
}

export function useUpdateMemory(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      content?: string;
      category?: MemoryCategory;
      pinned?: boolean;
      archived?: boolean;
      confirmationStatus?: "suggested" | "confirmed";
      useInContext?: boolean;
      projectId?: string | null;
    }) => {
      if (!userId) throw new Error("Not authenticated");
      if (input.content !== undefined) {
        const content = input.content.trim();
        if (!content) throw new Error("Memory cannot be empty");
        if (isSensitive(content)) throw new Error("That looks like a secret. Not saved.");
      }
      const tag = createClientTag();
      markClientTagSent(tag);

      const update: Database["public"]["Tables"]["memories"]["Update"] = {
        client_tag: tag,
        ...(input.content !== undefined ? { content: input.content.trim() } : {}),
        ...(input.content !== undefined
          ? {
              embedding: await embed(input.content.trim())
                .then((result) => result.vector)
                .catch(() => null),
            }
          : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
        ...(input.archived !== undefined ? { archived: input.archived } : {}),
        ...(input.confirmationStatus !== undefined
          ? { confirmation_status: input.confirmationStatus }
          : {}),
        ...(input.useInContext !== undefined ? { use_in_context: input.useInContext } : {}),
        ...(input.projectId !== undefined ? { project_id: input.projectId } : {}),
      };

      const { error } = await supabase
        .from("memories")
        .update(update)
        .eq("id", input.id)
        .eq("user_id", userId);
      if (error) throw error;
      invalidateBrainContextCache(userId);
    },
    onMutate: async (input) => {
      if (!userId) return;
      await qc.cancelQueries({ queryKey: MEMORIES_KEY(userId) });
      const previous = qc.getQueryData<MemoryRecord[]>(MEMORIES_KEY(userId));
      patchMemoriesCache(qc, userId, (old) =>
        old.map((m) =>
          m.id === input.id
            ? {
                ...m,
                ...(input.content !== undefined ? { content: input.content!.trim() } : {}),
                ...(input.category !== undefined ? { category: input.category! } : {}),
                ...(input.pinned !== undefined ? { pinned: input.pinned! } : {}),
                ...(input.archived !== undefined ? { archived: input.archived! } : {}),
                ...(input.confirmationStatus !== undefined
                  ? { confirmation_status: input.confirmationStatus }
                  : {}),
                ...(input.useInContext !== undefined ? { use_in_context: input.useInContext } : {}),
                ...(input.projectId !== undefined ? { project_id: input.projectId } : {}),
              }
            : m,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId) {
        qc.setQueryData(MEMORIES_KEY(userId), context.previous);
      }
    },
    onSettled: () => {
      if (userId) qc.invalidateQueries({ queryKey: MEMORIES_KEY(userId) });
    },
  });
}

export function useDeleteMemory(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error("Not authenticated");
      const tag = createClientTag();
      markClientTagSent(tag);
      const { error } = await supabase.from("memories").delete().eq("id", id).eq("user_id", userId);
      if (error) throw error;
      invalidateBrainContextCache(userId);
    },
    onMutate: async (id) => {
      if (!userId) return;
      await qc.cancelQueries({ queryKey: MEMORIES_KEY(userId) });
      const previous = qc.getQueryData<MemoryRecord[]>(MEMORIES_KEY(userId));
      patchMemoriesCache(qc, userId, (old) => old.filter((m) => m.id !== id));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId) {
        qc.setQueryData(MEMORIES_KEY(userId), context.previous);
      }
    },
    onSettled: () => {
      if (userId) qc.invalidateQueries({ queryKey: MEMORIES_KEY(userId) });
    },
  });
}

export function useClearMemories(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase.from("memories").delete().eq("user_id", userId);
      if (error) throw error;
      invalidateBrainContextCache(userId);
    },
    onMutate: async () => {
      if (!userId) return;
      await qc.cancelQueries({ queryKey: MEMORIES_KEY(userId) });
      const previous = qc.getQueryData<MemoryRecord[]>(MEMORIES_KEY(userId));
      qc.setQueryData(MEMORIES_KEY(userId), []);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId) {
        qc.setQueryData(MEMORIES_KEY(userId), context.previous);
      }
    },
    onSettled: () => {
      if (userId) qc.invalidateQueries({ queryKey: MEMORIES_KEY(userId) });
    },
  });
}

export function useUpdateMemorySettings(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<MemorySettings, "user_id" | "updated_at">>) => {
      if (!userId) throw new Error("Not authenticated");
      const update = { ...patch, user_id: userId, updated_at: new Date().toISOString() };
      const { error } = await supabase
        .from("memory_settings")
        .upsert(update, { onConflict: "user_id" });
      if (error) throw error;
      invalidateBrainContextCache(userId);
    },
    onMutate: async (patch) => {
      if (!userId) return;
      await qc.cancelQueries({ queryKey: MEMORY_SETTINGS_KEY(userId) });
      const previous = qc.getQueryData<MemorySettings>(MEMORY_SETTINGS_KEY(userId));
      qc.setQueryData<MemorySettings>(MEMORY_SETTINGS_KEY(userId), (old) =>
        old
          ? { ...old, ...patch }
          : ({ ...DEFAULT_MEMORY_SETTINGS, user_id: userId, ...patch } as MemorySettings),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId) {
        qc.setQueryData(MEMORY_SETTINGS_KEY(userId), context.previous);
      }
    },
    onSettled: () => {
      if (userId) qc.invalidateQueries({ queryKey: MEMORY_SETTINGS_KEY(userId) });
    },
  });
}

// ---- Dedup helper ----------------------------------------------------------
/** True if an equivalent memory (same content, roughly) already exists. */
export function memoryExists(
  memories: MemoryRecord[],
  content: string,
  projectId?: string | null,
): boolean {
  return memories.some(
    (memory) =>
      (projectId ? !memory.project_id || memory.project_id === projectId : !memory.project_id) &&
      arePossibleDuplicates(memory.content, content),
  );
}
