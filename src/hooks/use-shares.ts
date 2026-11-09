/**
 * React Query hooks for Chat Sharing.
 *
 * All mutations are optimistic against the `["shares", userId]` cache:
 *   * create  → inserts the returned share immediately, rolls back on error.
 *   * revoke  → removes the share from the cache instantly; old URLs stop
 *              resolving because the server row is deleted in the same call.
 *
 * Reads go through the public `/api/shared/:token` endpoint (no auth) so shared
 * conversations render for anonymous visitors.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ShareRecord, SharedConversation } from "@/lib/share";
import { getShareUrl } from "@/lib/share";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

const API_BASE = ""; // same-origin; native uses relative path too

export const sharesQueryKey = (userId: string) => ["shares", userId] as const;

export function useShares(userId: string) {
  return useQuery({
    queryKey: sharesQueryKey(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<ShareRecord[]> => {
      const res = await authenticatedFetch(`${API_BASE}/api/shares`);
      if (!res.ok) throw new Error("Failed to load shares");
      const json = (await res.json()) as { shares: ShareRecord[] };
      return json.shares;
    },
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authenticatedFetch(url, init);
  if (!res.ok) {
    let message = "Request failed";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function useCreateShare(userId: string) {
  const qc = useQueryClient();
  const key = sharesQueryKey(userId);
  return useMutation({
    mutationFn: async (conversationId: string) => {
      const json = await fetchJson<{ share: ShareRecord; created: boolean }>(
        `${API_BASE}/api/shares`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        },
      );
      return json.share;
    },
    onMutate: async (conversationId) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ShareRecord[]>(key);
      // Optimistically add a placeholder share so the UI updates instantly.
      const optimistic: ShareRecord = {
        id: `temp-${crypto.randomUUID()}`,
        conversation_id: conversationId,
        share_token: crypto.randomUUID(),
        created_by: userId,
        created_at: new Date().toISOString(),
        expires_at: null,
        is_public: true,
      };
      qc.setQueryData<ShareRecord[]>(key, (old) => {
        const without = (old ?? []).filter((s) => s.conversation_id !== conversationId);
        return [optimistic, ...without];
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
      toast.error("Couldn't create share link.");
    },
    onSuccess: (share) => {
      // Replace the optimistic placeholder with the server record.
      qc.setQueryData<ShareRecord[]>(key, (old) =>
        (old ?? []).map((s) =>
          s.conversation_id === share.conversation_id && s.id.startsWith("temp-") ? share : s,
        ),
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key, exact: true });
    },
  });
}

export function useRevokeShare(userId: string) {
  const qc = useQueryClient();
  const key = sharesQueryKey(userId);
  return useMutation({
    mutationFn: async (token: string) => {
      await fetchJson<{ revoked: boolean }>(`${API_BASE}/api/shares/${token}`, {
        method: "DELETE",
      });
    },
    onMutate: async (token) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ShareRecord[]>(key);
      qc.setQueryData<ShareRecord[]>(key, (old) =>
        (old ?? []).filter((s) => s.share_token !== token),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
      toast.error("Couldn't revoke share.");
    },
    onSuccess: () => {
      toast.success("Share link revoked.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key, exact: true });
    },
  });
}

/** Fetch a public shared conversation by token (no auth). */
export function useSharedConversation(token: string | undefined) {
  return useQuery({
    queryKey: ["shared-conversation", token],
    enabled: !!token,
    queryFn: async (): Promise<SharedConversation> => {
      const res = await fetch(`${API_BASE}/api/shared/${token}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) throw new Error("This shared conversation is unavailable.");
        throw new Error("Failed to load shared conversation.");
      }
      const json = (await res.json()) as { conversation: SharedConversation };
      return json.conversation;
    },
    staleTime: 30_000,
  });
}

export { getShareUrl };
export type { ShareRecord };
