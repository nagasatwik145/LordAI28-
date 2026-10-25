import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createClientTag, markClientTagSent } from "@/lib/realtime/client-tag";
import type { ProjectNote, ProjectTask, ActivityItem } from "./types";

export const PROJECTS_KEY = (userId: string | null | undefined) =>
  ["projects", userId ?? "anon"] as const;

export const PROJECT_KEY = (userId: string | null | undefined, projectId: string) =>
  ["project", userId ?? "anon", projectId] as const;

export const PROJECT_NOTES_KEY = (userId: string | null | undefined, projectId: string) =>
  ["project_notes", userId ?? "anon", projectId] as const;

export const PROJECT_TASKS_KEY = (userId: string | null | undefined, projectId: string) =>
  ["project_tasks", userId ?? "anon", projectId] as const;

export const PROJECT_ACTIVITY_KEY = (userId: string | null | undefined, projectId: string) =>
  ["project_activity", userId ?? "anon", projectId] as const;

// ============================================================
// Types
// ============================================================

type DbProject = Database["public"]["Tables"]["projects"]["Row"];
type DbProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
type DbProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];

export interface ProjectRow extends DbProject {
  conversationCount?: number;
  fileCount?: number;
  knowledgeCount?: number;
  memoryCount?: number;
  taskCount?: number;
  noteCount?: number;
}

// ============================================================
// Queries
// ============================================================

export async function fetchProjects(userId: string): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", userId)
    .order("is_pinned", { ascending: false })
    .order("last_accessed_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as DbProject[];
}

export function useProjects(userId: string | null | undefined) {
  return useQuery({
    queryKey: PROJECTS_KEY(userId),
    enabled: !!userId,
    retry: false,
    queryFn: () => fetchProjects(userId!),
  });
}

export function useProject(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  return useQuery({
    queryKey: projectId ? PROJECT_KEY(userId, projectId) : ["project", "none"],
    enabled: !!userId && !!projectId,
    queryFn: async (): Promise<ProjectRow | null> => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .eq("user_id", userId!)
        .maybeSingle();

      if (error) throw error;
      return (data ?? null) as DbProject | null;
    },
  });
}

export function useProjectNotes(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  return useQuery({
    queryKey: projectId ? PROJECT_NOTES_KEY(userId, projectId) : ["notes", "none"],
    enabled: !!userId && !!projectId,
    queryFn: async (): Promise<ProjectNote[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("project_notes")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", userId!)
        .order("is_pinned", { ascending: false })
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((n) => ({
        id: n.id,
        projectId: n.project_id,
        userId: n.user_id,
        title: n.title,
        content: n.content,
        tags: n.tags ?? [],
        isPinned: n.is_pinned,
        isArchived: n.is_archived,
        createdAt: n.created_at,
        updatedAt: n.updated_at,
      }));
    },
  });
}

export function useProjectTasks(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  return useQuery({
    queryKey: projectId ? PROJECT_TASKS_KEY(userId, projectId) : ["tasks", "none"],
    enabled: !!userId && !!projectId,
    queryFn: async (): Promise<ProjectTask[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("project_tasks")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", userId!)
        .order("status")
        .order("priority")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((t) => ({
        id: t.id,
        projectId: t.project_id,
        userId: t.user_id,
        title: t.title,
        description: t.description ?? undefined,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_date ?? undefined,
        completedAt: t.completed_at ?? undefined,
        tags: t.tags ?? [],
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      }));
    },
  });
}

export function useProjectActivity(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  return useQuery({
    queryKey: projectId ? PROJECT_ACTIVITY_KEY(userId, projectId) : ["activity", "none"],
    enabled: !!userId && !!projectId,
    queryFn: async (): Promise<ActivityItem[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("project_activity")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return (data ?? []).map((a) => ({
        id: a.id,
        projectId: a.project_id,
        userId: a.user_id,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id ?? undefined,
        metadata: (a.metadata as Record<string, unknown>) ?? {},
        createdAt: a.created_at,
      }));
    },
  });
}

// ============================================================
// Mutations
// ============================================================

export function useCreateProject(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      color?: string;
      icon?: string;
    }) => {
      if (!userId) throw new Error("Not authenticated");
      const insert: DbProjectInsert = {
        user_id: userId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? "#3b82f6",
        icon: input.icon ?? "folder",
      };
      const { data, error } = await supabase.from("projects").insert(insert).select().single();
      if (error) throw error;
      return data as DbProject;
    },
    onMutate: async (input) => {
      if (!userId) return;
      await qc.cancelQueries({ queryKey: PROJECTS_KEY(userId) });
      const previous = qc.getQueryData<ProjectRow[]>(PROJECTS_KEY(userId));
      const optimistic: ProjectRow = {
        id: `temp-${createClientTag()}`,
        user_id: userId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? "#3b82f6",
        icon: input.icon ?? "folder",
        is_pinned: false,
        is_archived: false,
        last_accessed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      qc.setQueryData<ProjectRow[]>(PROJECTS_KEY(userId), (old) => [optimistic, ...(old ?? [])]);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId) {
        qc.setQueryData(PROJECTS_KEY(userId), context.previous);
      }
    },
    onSettled: () => {
      if (userId) qc.invalidateQueries({ queryKey: PROJECTS_KEY(userId) });
    },
  });
}

export function useUpdateProject(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<DbProjectUpdate> }) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("projects")
        .update(input.patch)
        .eq("id", input.id)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onMutate: async (input) => {
      if (!userId) return;
      await qc.cancelQueries({ queryKey: PROJECTS_KEY(userId) });
      const previous = qc.getQueryData<ProjectRow[]>(PROJECTS_KEY(userId));
      qc.setQueryData<ProjectRow[]>(PROJECTS_KEY(userId), (old) =>
        (old ?? []).map((p) => (p.id === input.id ? { ...p, ...input.patch } : p)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId) {
        qc.setQueryData(PROJECTS_KEY(userId), context.previous);
      }
    },
    onSettled: () => {
      if (userId) qc.invalidateQueries({ queryKey: PROJECTS_KEY(userId) });
    },
  });
}

export function useDeleteProject(userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error("Not authenticated");
      const { error } = await supabase.from("projects").delete().eq("id", id).eq("user_id", userId);
      if (error) throw error;
    },
    onMutate: async (id) => {
      if (!userId) return;
      await qc.cancelQueries({ queryKey: PROJECTS_KEY(userId) });
      const previous = qc.getQueryData<ProjectRow[]>(PROJECTS_KEY(userId));
      qc.setQueryData<ProjectRow[]>(PROJECTS_KEY(userId), (old) =>
        (old ?? []).filter((p) => p.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId) {
        qc.setQueryData(PROJECTS_KEY(userId), context.previous);
      }
    },
    onSettled: () => {
      if (userId) qc.invalidateQueries({ queryKey: PROJECTS_KEY(userId) });
    },
  });
}

export function useCreateNote(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title?: string; content?: string; tags?: string[] }) => {
      if (!userId || !projectId) throw new Error("Not authenticated or missing project");
      const { data, error } = await supabase
        .from("project_notes")
        .insert({
          project_id: projectId,
          user_id: userId,
          title: input.title ?? "Untitled Note",
          content: input.content ?? "",
          tags: input.tags ?? [],
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onMutate: async (input) => {
      if (!userId || !projectId) return;
      await qc.cancelQueries({ queryKey: PROJECT_NOTES_KEY(userId, projectId) });
      const previous = qc.getQueryData<ProjectNote[]>(PROJECT_NOTES_KEY(userId, projectId));
      const optimistic: ProjectNote = {
        id: `temp-${createClientTag()}`,
        projectId,
        userId,
        title: input.title ?? "Untitled Note",
        content: input.content ?? "",
        tags: input.tags ?? [],
        isPinned: false,
        isArchived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      qc.setQueryData<ProjectNote[]>(PROJECT_NOTES_KEY(userId, projectId), (old) => [
        optimistic,
        ...(old ?? []),
      ]);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId && projectId) {
        qc.setQueryData(PROJECT_NOTES_KEY(userId, projectId), context.previous);
      }
    },
    onSettled: () => {
      if (userId && projectId)
        qc.invalidateQueries({ queryKey: PROJECT_NOTES_KEY(userId, projectId) });
    },
  });
}

export function useUpdateNote(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      expectedUpdatedAt?: string;
      patch: Partial<{
        title: string;
        content: string;
        tags: string[];
        isPinned: boolean;
        isArchived: boolean;
      }>;
    }) => {
      if (!userId || !projectId) throw new Error("Not authenticated or missing project");
      const update: {
        title?: string;
        content?: string;
        tags?: string[];
        is_pinned?: boolean;
        is_archived?: boolean;
      } = {};
      if (input.patch.title !== undefined) update.title = input.patch.title;
      if (input.patch.content !== undefined) update.content = input.patch.content;
      if (input.patch.tags !== undefined) update.tags = input.patch.tags;
      if (input.patch.isPinned !== undefined) update.is_pinned = input.patch.isPinned;
      if (input.patch.isArchived !== undefined) update.is_archived = input.patch.isArchived;

      let query = supabase
        .from("project_notes")
        .update(update)
        .eq("id", input.id)
        .eq("project_id", projectId)
        .eq("user_id", userId);
      if (input.expectedUpdatedAt)
        query = query.eq("updated_at", input.expectedUpdatedAt) as typeof query;
      const { data, error } = await query.select("id").maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("This note changed elsewhere. Reload it before saving.");
    },
    onMutate: async (input) => {
      if (!userId || !projectId) return;
      await qc.cancelQueries({ queryKey: PROJECT_NOTES_KEY(userId, projectId) });
      const previous = qc.getQueryData<ProjectNote[]>(PROJECT_NOTES_KEY(userId, projectId));
      qc.setQueryData<ProjectNote[]>(PROJECT_NOTES_KEY(userId, projectId), (old) =>
        (old ?? []).map((n) => (n.id === input.id ? { ...n, ...input.patch } : n)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId && projectId) {
        qc.setQueryData(PROJECT_NOTES_KEY(userId, projectId), context.previous);
      }
    },
    onSettled: () => {
      if (userId && projectId)
        qc.invalidateQueries({ queryKey: PROJECT_NOTES_KEY(userId, projectId) });
    },
  });
}

export function useDeleteNote(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId || !projectId) throw new Error("Not authenticated or missing project");
      const { error } = await supabase
        .from("project_notes")
        .delete()
        .eq("id", id)
        .eq("project_id", projectId)
        .eq("user_id", userId);

      if (error) throw error;
    },
    onMutate: async (id) => {
      if (!userId || !projectId) return;
      await qc.cancelQueries({ queryKey: PROJECT_NOTES_KEY(userId, projectId) });
      const previous = qc.getQueryData<ProjectNote[]>(PROJECT_NOTES_KEY(userId, projectId));
      qc.setQueryData<ProjectNote[]>(PROJECT_NOTES_KEY(userId, projectId), (old) =>
        (old ?? []).filter((n) => n.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId && projectId) {
        qc.setQueryData(PROJECT_NOTES_KEY(userId, projectId), context.previous);
      }
    },
    onSettled: () => {
      if (userId && projectId)
        qc.invalidateQueries({ queryKey: PROJECT_NOTES_KEY(userId, projectId) });
    },
  });
}

export function useCreateTask(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      description?: string;
      priority?: string;
      dueDate?: string;
      tags?: string[];
    }) => {
      if (!userId || !projectId) throw new Error("Not authenticated or missing project");
      const { data, error } = await supabase
        .from("project_tasks")
        .insert({
          project_id: projectId,
          user_id: userId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? "medium",
          due_date: input.dueDate ?? null,
          tags: input.tags ?? [],
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onMutate: async (input) => {
      if (!userId || !projectId) return;
      await qc.cancelQueries({ queryKey: PROJECT_TASKS_KEY(userId, projectId) });
      const previous = qc.getQueryData<ProjectTask[]>(PROJECT_TASKS_KEY(userId, projectId));
      const optimistic: ProjectTask = {
        id: `temp-${createClientTag()}`,
        projectId,
        userId,
        title: input.title,
        description: input.description,
        status: "todo",
        priority: input.priority ?? "medium",
        dueDate: input.dueDate,
        tags: input.tags ?? [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      qc.setQueryData<ProjectTask[]>(PROJECT_TASKS_KEY(userId, projectId), (old) => [
        optimistic,
        ...(old ?? []),
      ]);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId && projectId) {
        qc.setQueryData(PROJECT_TASKS_KEY(userId, projectId), context.previous);
      }
    },
    onSettled: () => {
      if (userId && projectId)
        qc.invalidateQueries({ queryKey: PROJECT_TASKS_KEY(userId, projectId) });
    },
  });
}

export function useUpdateTask(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<{
        title: string;
        description: string;
        status: string;
        priority: string;
        dueDate: string;
        tags: string[];
      }>;
    }) => {
      if (!userId || !projectId) throw new Error("Not authenticated or missing project");
      const update: {
        title?: string;
        description?: string;
        status?: string;
        priority?: string;
        due_date?: string;
        tags?: string[];
        completed_at?: string | null;
      } = {};
      if (input.patch.title !== undefined) update.title = input.patch.title;
      if (input.patch.description !== undefined) update.description = input.patch.description;
      if (input.patch.status !== undefined) update.status = input.patch.status;
      if (input.patch.priority !== undefined) update.priority = input.patch.priority;
      if (input.patch.dueDate !== undefined) update.due_date = input.patch.dueDate;
      if (input.patch.tags !== undefined) update.tags = input.patch.tags;
      if (input.patch.status !== undefined) {
        update.completed_at = input.patch.status === "done" ? new Date().toISOString() : null;
      }

      const { error } = await supabase
        .from("project_tasks")
        .update(update)
        .eq("id", input.id)
        .eq("project_id", projectId)
        .eq("user_id", userId);

      if (error) throw error;
    },
    onMutate: async (input) => {
      if (!userId || !projectId) return;
      await qc.cancelQueries({ queryKey: PROJECT_TASKS_KEY(userId, projectId) });
      const previous = qc.getQueryData<ProjectTask[]>(PROJECT_TASKS_KEY(userId, projectId));
      qc.setQueryData<ProjectTask[]>(PROJECT_TASKS_KEY(userId, projectId), (old) =>
        (old ?? []).map((t) => (t.id === input.id ? { ...t, ...input.patch } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId && projectId) {
        qc.setQueryData(PROJECT_TASKS_KEY(userId, projectId), context.previous);
      }
    },
    onSettled: () => {
      if (userId && projectId)
        qc.invalidateQueries({ queryKey: PROJECT_TASKS_KEY(userId, projectId) });
    },
  });
}

export function useDeleteTask(
  userId: string | null | undefined,
  projectId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId || !projectId) throw new Error("Not authenticated or missing project");
      const { error } = await supabase
        .from("project_tasks")
        .delete()
        .eq("id", id)
        .eq("project_id", projectId)
        .eq("user_id", userId);

      if (error) throw error;
    },
    onMutate: async (id) => {
      if (!userId || !projectId) return;
      await qc.cancelQueries({ queryKey: PROJECT_TASKS_KEY(userId, projectId) });
      const previous = qc.getQueryData<ProjectTask[]>(PROJECT_TASKS_KEY(userId, projectId));
      qc.setQueryData<ProjectTask[]>(PROJECT_TASKS_KEY(userId, projectId), (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && userId && projectId) {
        qc.setQueryData(PROJECT_TASKS_KEY(userId, projectId), context.previous);
      }
    },
    onSettled: () => {
      if (userId && projectId)
        qc.invalidateQueries({ queryKey: PROJECT_TASKS_KEY(userId, projectId) });
    },
  });
}

export async function recordProjectActivity(params: {
  projectId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  const { projectId, userId, action, entityType, entityId, metadata } = params;
  try {
    await supabase.from("project_activity").insert({
      project_id: projectId,
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      metadata: (metadata ??
        {}) as unknown as Database["public"]["Tables"]["project_activity"]["Row"]["metadata"],
    });
  } catch {
    // best-effort logging
  }
}
