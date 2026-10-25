import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Check,
  CircleHelp,
  Loader2,
  Network,
  Pin,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/lord/AppShell";
import { Button } from "@/components/ui/button";
import { HudPanel } from "@/components/lord/HudPanel";
import { MindGraphNodeList } from "@/components/lord/MindGraphNodeList";
import { supabase } from "@/integrations/supabase/client";
import {
  useMemorySettings,
  useUpdateMemory,
  useUpdateMemorySettings,
  type MemoryCategory,
  type MemoryRecord,
} from "@/lib/memory";
import {
  buildMindGraph,
  findMemoryIssues,
  mindGraphNodeColor,
  type MindGraphNode,
  type MindGraphConversation,
  type MindGraphFile,
  type MindGraphProject,
  type MindGraphTask,
} from "@/lib/memory/graph";
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_LABELS } from "@/lib/memory/types";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { invalidateBrainContextCache } from "@/lib/brain/context-cache";
import { getSafeErrorMessage } from "@/lib/api-error";

export const Route = createFileRoute("/_authenticated/mind-graph")({
  head: () => ({
    meta: [
      { title: "LORD — Mind Graph" },
      { name: "description", content: "Explore and manage your project memories." },
    ],
  }),
  component: MindGraphPage,
});

const MAX_MEMORIES = 120;
const MAX_TASKS = 60;

type GraphFilter =
  "all" | "suggested" | "confirmed" | MemoryCategory | "task" | "workspace" | "project-category";

function memoryFromRow(row: Database["public"]["Tables"]["memories"]["Row"]): MemoryRecord | null {
  if (!row.content || !row.user_id) return null;
  const embedding =
    Array.isArray(row.embedding) && row.embedding.every((value) => typeof value === "number")
      ? row.embedding
      : null;
  return {
    id: row.id,
    user_id: row.user_id,
    content: row.content,
    category: (row.category as MemoryCategory) ?? "note",
    pinned: row.pinned ?? false,
    confidence: row.confidence,
    source: (row.source as MemoryRecord["source"]) ?? "manual",
    embedding,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    project_id: row.project_id,
    source_conversation_id: row.source_conversation_id,
    confirmation_status: row.confirmation_status as MemoryRecord["confirmation_status"],
    use_in_context: row.use_in_context,
    archived: row.archived,
  };
}

function graphPosition(index: number, count: number) {
  const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
  const ring = Math.floor(index / 40);
  return {
    x: 500 + Math.cos(angle) * (ring === 0 ? 190 : 190 + ring * 88),
    y: 320 + Math.sin(angle) * (ring === 0 ? 145 : 145 + ring * 64),
  };
}

function visibleForFilter(node: MindGraphNode, filter: GraphFilter): boolean {
  if (filter === "all") return true;
  if (filter === "task") return node.kind === "task";
  if (filter === "workspace") return node.kind === "project";
  if (filter === "project-category") return node.kind === "memory" && node.category === "project";
  if (filter === "suggested" || filter === "confirmed") {
    return node.kind === "memory" && node.memory?.confirmation_status === filter;
  }
  return node.kind === "memory" && node.category === filter;
}

function MindGraphPage() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("all");
  const [memoryPage, setMemoryPage] = useState(0);
  const [filter, setFilter] = useState<GraphFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingContent, setEditingContent] = useState("");
  const [editingCategory, setEditingCategory] = useState<MemoryCategory>("note");
  const [indexing, setIndexing] = useState(false);
  const [knowledgeQuestion, setKnowledgeQuestion] = useState("");
  const [knowledgeAnswer, setKnowledgeAnswer] = useState<string | null>(null);
  const [knowledgeSuggestions, setKnowledgeSuggestions] = useState<
    { id: string; name: string; source_type: string }[]
  >([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const { data: settings } = useMemorySettings(user.id);
  const updateMemory = useUpdateMemory(user.id);
  const updateSettings = useUpdateMemorySettings(user.id);

  const projectsQuery = useQuery({
    queryKey: ["mind-graph", "projects", user.id],
    retry: false,
    queryFn: async (): Promise<MindGraphProject[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name")
        .eq("user_id", user.id)
        .eq("is_archived", false)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const memoriesQuery = useQuery({
    queryKey: ["mind-graph", "memories", user.id, projectId, showArchived, memoryPage],
    retry: false,
    queryFn: async (): Promise<{ records: MemoryRecord[]; total: number }> => {
      let query = supabase
        .from("memories")
        .select("*", { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(memoryPage * MAX_MEMORIES, (memoryPage + 1) * MAX_MEMORIES - 1);
      if (!showArchived) query = query.eq("archived", false);
      if (projectId !== "all") query = query.or(`project_id.eq.${projectId},project_id.is.null`);
      const { data, count, error } = await query;
      if (error) throw error;
      return {
        records: (data ?? [])
          .map((row) => memoryFromRow(row))
          .filter((row): row is MemoryRecord => row !== null),
        total: count ?? 0,
      };
    },
  });

  const tasksQuery = useQuery({
    queryKey: ["mind-graph", "tasks", user.id, projectId],
    retry: false,
    queryFn: async (): Promise<MindGraphTask[]> => {
      let query = supabase
        .from("project_tasks")
        .select("id,title,status,priority,created_at,project_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(MAX_TASKS);
      if (projectId !== "all") query = query.eq("project_id", projectId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const conversationsQuery = useQuery({
    queryKey: ["mind-graph", "conversations", user.id, projectId],
    retry: false,
    queryFn: async (): Promise<MindGraphConversation[]> => {
      let query = supabase
        .from("conversations")
        .select("id,title,created_at,project_id")
        .eq("user_id", user.id)
        .eq("archived", false)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (projectId !== "all") query = query.or(`project_id.eq.${projectId},project_id.is.null`);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const filesQuery = useQuery({
    queryKey: ["mind-graph", "files", user.id, projectId],
    retry: false,
    queryFn: async (): Promise<MindGraphFile[]> => {
      let query = supabase
        .from("knowledge_sources")
        .select("id,name,source_type,created_at,project_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (projectId !== "all") query = query.or(`project_id.eq.${projectId},project_id.is.null`);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });

  const memorySettings = settings;
  const memoryRecords = useMemo(
    () => memoriesQuery.data?.records ?? [],
    [memoriesQuery.data?.records],
  );
  const memoryTotal = memoriesQuery.data?.total ?? 0;
  const memoryPages = Math.max(1, Math.ceil(memoryTotal / MAX_MEMORIES));
  const projects = useMemo(
    () =>
      (projectsQuery.data ?? []).filter(
        (project) => projectId === "all" || project.id === projectId,
      ),
    [projectId, projectsQuery.data],
  );
  const graph = useMemo(
    () =>
      buildMindGraph(
        memoryRecords,
        projects,
        tasksQuery.data ?? [],
        conversationsQuery.data ?? [],
        filesQuery.data ?? [],
      ),
    [conversationsQuery.data, filesQuery.data, memoryRecords, projects, tasksQuery.data],
  );
  const filteredNodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return graph.nodes.filter((node) => {
      if (projectId !== "all" && node.projectId && node.projectId !== projectId) return false;
      if (!visibleForFilter(node, filter)) return false;
      return !query || `${node.label} ${node.description}`.toLowerCase().includes(query);
    });
  }, [filter, graph.nodes, projectId, search]);
  const visibleIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const edges = useMemo(
    () => graph.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)),
    [graph.edges, visibleIds],
  );
  const positions = useMemo(
    () =>
      new Map(
        filteredNodes.map((node, index) => [node.id, graphPosition(index, filteredNodes.length)]),
      ),
    [filteredNodes],
  );
  const selectedNode = filteredNodes.find((node) => node.id === selectedId) ?? null;
  const selectedMemory = selectedNode?.memory;
  const issues = selectedMemory ? findMemoryIssues(selectedMemory, memoryRecords) : null;

  useEffect(() => {
    if (selectedId && !filteredNodes.some((node) => node.id === selectedId)) setSelectedId(null);
  }, [filteredNodes, selectedId]);

  useEffect(() => {
    setMemoryPage(0);
  }, [projectId, showArchived]);

  const saveEdit = async () => {
    if (!selectedMemory || !editingContent.trim()) return;
    try {
      await updateMemory.mutateAsync({
        id: selectedMemory.id,
        content: editingContent.trim(),
        category: editingCategory,
      });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["mind-graph", "memories", user.id] });
      invalidateBrainContextCache(user.id);
      toast.success("Memory updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update memory");
    }
  };

  const updateMemoryField = async (
    patch: Omit<Parameters<typeof updateMemory.mutateAsync>[0], "id">,
    successMessage: string,
  ) => {
    if (!selectedMemory) return;
    try {
      await updateMemory.mutateAsync({ ...patch, id: selectedMemory.id });
      await queryClient.invalidateQueries({ queryKey: ["mind-graph", "memories", user.id] });
      invalidateBrainContextCache(user.id);
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update memory");
    }
  };

  const deleteSelected = async () => {
    if (!selectedMemory) return;
    if (
      !confirm(
        "Delete this saved memory? This removes only the memory record; it does not delete its original conversation or copies elsewhere.",
      )
    ) {
      return;
    }
    try {
      const { error } = await supabase
        .from("memories")
        .delete()
        .eq("id", selectedMemory.id)
        .eq("user_id", user.id);
      if (error) throw error;
      invalidateBrainContextCache(user.id);
      await memoriesQuery.refetch();
      setSelectedId(null);
      toast.success("Memory deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete memory");
    }
  };

  const clearProjectMemories = async () => {
    if (projectId === "all") return;
    const projectName = projectsQuery.data?.find((project) => project.id === projectId)?.name;
    if (
      !confirm(
        `Delete saved memories assigned to ${projectName ?? "this project"}? This does not delete project tasks, the original conversations, or copies elsewhere.`,
      )
    ) {
      return;
    }
    try {
      const { error } = await supabase
        .from("memories")
        .delete()
        .eq("user_id", user.id)
        .eq("project_id", projectId);
      if (error) throw error;
      invalidateBrainContextCache(user.id);
      setSelectedId(null);
      await memoriesQuery.refetch();
      toast.success("Project memories cleared");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't clear project memories");
    }
  };

  const switchMemoryCollection = async (enabled: boolean) => {
    try {
      await updateSettings.mutateAsync({ memory_enabled: enabled });
      toast.success(
        enabled ? "Memory collection and use enabled" : "Memory collection and use disabled",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update memory setting");
    }
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    setDragStart({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragStart || !svgRef.current) return;
    const bounds = svgRef.current.getBoundingClientRect();
    setPan({
      x: dragStart.panX + ((event.clientX - dragStart.x) / bounds.width) * 1000,
      y: dragStart.panY + ((event.clientY - dragStart.y) / bounds.height) * 650,
    });
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setScale((current) => Math.min(2.4, Math.max(0.55, current * (event.deltaY < 0 ? 1.1 : 0.9))));
  };

  const graphError =
    projectsQuery.error ??
    memoriesQuery.error ??
    tasksQuery.error ??
    conversationsQuery.error ??
    filesQuery.error;
  const isLoading =
    projectsQuery.isLoading ||
    memoriesQuery.isLoading ||
    tasksQuery.isLoading ||
    conversationsQuery.isLoading ||
    filesQuery.isLoading;
  const isRetrying =
    projectsQuery.isFetching ||
    memoriesQuery.isFetching ||
    tasksQuery.isFetching ||
    conversationsQuery.isFetching ||
    filesQuery.isFetching;
  const retryGraph = async () => {
    await Promise.all([
      projectsQuery.refetch(),
      memoriesQuery.refetch(),
      tasksQuery.refetch(),
      conversationsQuery.refetch(),
      filesQuery.refetch(),
    ]);
  };

  const indexKnowledge = async () => {
    setIndexing(true);
    try {
      const response = await fetch("/api/knowledge-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "index" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Indexing failed");
      await loadKnowledgeSuggestions();
      toast.success(`Indexed ${result.indexed} new concepts from ${result.sources} sources`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't index knowledge");
    } finally {
      setIndexing(false);
    }
  };

  const loadKnowledgeSuggestions = async () => {
    const response = await fetch("/api/knowledge-graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_pending" }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Couldn't load suggestions");
    setKnowledgeSuggestions(result.suggestions ?? []);
  };

  const reviewKnowledgeSuggestion = async (
    id: string,
    action: "approve" | "dismiss" | "delete",
  ) => {
    const response = await fetch("/api/knowledge-graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: action === "delete" ? "delete" : "review",
        entityId: id,
        status: action === "approve" ? "approved" : "dismissed",
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Couldn't update suggestion");
    setKnowledgeSuggestions((items) => items.filter((item) => item.id !== id));
  };

  const searchKnowledge = async () => {
    if (!knowledgeQuestion.trim()) return;
    setKnowledgeAnswer(null);
    try {
      const response = await fetch("/api/knowledge-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query: knowledgeQuestion }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Search failed");
      setKnowledgeAnswer(
        result.results.length
          ? result.results
              .map(
                (item: { name: string; source_type: string }) =>
                  `${item.name} · ${item.source_type}`,
              )
              .join("\n")
          : "No approved indexed concepts match. Index your content and review suggestions first.",
      );
    } catch (error) {
      setKnowledgeAnswer(error instanceof Error ? error.message : "Search failed");
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl tracking-wide gradient-text sm:text-3xl">
              <Network className="h-6 w-6" aria-hidden="true" /> LORD Mind Graph
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Your private, editable map of project context, tasks, and saved memories. Model
              suggestions stay unconfirmed until you approve them.
            </p>
          </div>
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 text-sm">
            <span className="text-muted-foreground">Project</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="max-w-48 bg-transparent text-foreground outline-none"
              aria-label="Filter Mind Graph by project"
            >
              <option value="all">All projects</option>
              {(projectsQuery.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={() => void indexKnowledge()}
            disabled={indexing}
            className="min-h-11 gap-2"
          >
            {indexing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {indexing ? "Indexing…" : "Index my knowledge"}
          </Button>
        </header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0 space-y-3" aria-label="Mind Graph visualization">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-48 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search memories, tasks, and projects"
                  aria-label="Search graph nodes"
                  className="min-h-11 w-full rounded-lg border border-border/60 bg-card/60 pl-9 pr-3 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border/60 px-3 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                  className="accent-primary"
                />
                Show archived
              </label>
              <button
                onClick={() => {
                  setScale(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="min-h-11 rounded-lg border border-border/60 px-3 text-sm hover:border-primary"
              >
                Reset view
              </button>
              {projectId !== "all" && (
                <button
                  onClick={clearProjectMemories}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" /> Clear project memories
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                Memory page {memoryPage + 1} of {memoryPages} · {memoryTotal} total
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setMemoryPage((page) => Math.max(0, page - 1))}
                  disabled={memoryPage === 0}
                  className="min-h-9 rounded-md border border-border/60 px-3 disabled:opacity-40"
                >
                  Newer
                </button>
                <button
                  onClick={() => setMemoryPage((page) => Math.min(memoryPages - 1, page + 1))}
                  disabled={memoryPage >= memoryPages - 1}
                  className="min-h-9 rounded-md border border-border/60 px-3 disabled:opacity-40"
                >
                  Older
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5" aria-label="Filter graph nodes">
              {(
                [
                  "all",
                  "suggested",
                  "confirmed",
                  "profile",
                  "preference",
                  "fact",
                  "project-category",
                  "note",
                  "task",
                  "workspace",
                ] as GraphFilter[]
              ).map((choice) => (
                <button
                  key={choice}
                  onClick={() => setFilter(choice)}
                  aria-pressed={filter === choice}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-xs transition-colors",
                    filter === choice
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {choice === "all"
                    ? "All nodes"
                    : choice === "suggested"
                      ? "Needs review"
                      : choice === "confirmed"
                        ? "Confirmed"
                        : choice === "task"
                          ? "Tasks"
                          : choice === "workspace"
                            ? "Project spaces"
                            : choice === "project-category"
                              ? "Project memories"
                              : MEMORY_CATEGORY_LABELS[choice as MemoryCategory]}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-border/60 bg-slate-950/50">
              {isLoading ? (
                <div className="grid min-h-[22rem] place-items-center text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading your graph…
                  </span>
                </div>
              ) : graphError ? (
                <div className="grid min-h-[22rem] place-items-center gap-3 p-6 text-sm text-destructive">
                  <p>Couldn’t load the Mind Graph: {getSafeErrorMessage(graphError)}</p>
                  <Button
                    variant="outline"
                    onClick={() => void retryGraph()}
                    disabled={isRetrying}
                    className="gap-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
                    {isRetrying ? "Retrying…" : "Retry"}
                  </Button>
                </div>
              ) : filteredNodes.length === 0 ? (
                <div className="grid min-h-[22rem] place-items-center p-6 text-center">
                  <div className="max-w-sm">
                    <CircleHelp className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                    <p className="font-medium">
                      {graph.nodes.length === 0
                        ? "Your graph is ready for its first connection"
                        : "No nodes match"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {graph.nodes.length === 0
                        ? "Create a project task or save a memory to begin. LORD does not infer confirmed facts."
                        : "Try another search or filter. Archived memories can be shown from the controls above."}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <svg
                    ref={svgRef}
                    viewBox="0 0 1000 650"
                    role="group"
                    aria-label={`Interactive project graph with ${filteredNodes.length} nodes and ${edges.length} relationships. Use the node list below on small screens.`}
                    className="hidden h-[min(66vh,42rem)] min-h-[26rem] w-full cursor-grab touch-none md:block active:cursor-grabbing"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={() => setDragStart(null)}
                    onPointerCancel={() => setDragStart(null)}
                    onWheel={handleWheel}
                  >
                    <defs>
                      <pattern id="graph-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                        <circle cx="1" cy="1" r="1" fill="rgba(148,163,184,0.15)" />
                      </pattern>
                    </defs>
                    <rect width="1000" height="650" fill="url(#graph-grid)" />
                    <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
                      {edges.map((edge, index) => {
                        const from = positions.get(edge.from);
                        const to = positions.get(edge.to);
                        if (!from || !to) return null;
                        return (
                          <line
                            key={`${edge.from}:${edge.to}:${index}`}
                            x1={from.x}
                            y1={from.y}
                            x2={to.x}
                            y2={to.y}
                            stroke={edge.relation === "possible conflict" ? "#f87171" : "#64748b"}
                            strokeOpacity={edge.relation === "belongs to" ? 0.25 : 0.4}
                            strokeWidth={edge.relation === "possible conflict" ? 2 : 1}
                            strokeDasharray={
                              edge.relation === "possible conflict" ? "5 4" : undefined
                            }
                          >
                            <title>{edge.relation}</title>
                          </line>
                        );
                      })}
                      {filteredNodes.map((node, index) => {
                        const point = positions.get(node.id);
                        if (!point) return null;
                        const color = mindGraphNodeColor(node);
                        const active = selectedId === node.id;
                        return (
                          <g
                            key={node.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`${node.kind}: ${node.label}`}
                            aria-pressed={active}
                            onClick={() => setSelectedId(node.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedId(node.id);
                              }
                            }}
                            className="cursor-pointer outline-none"
                          >
                            <circle
                              cx={point.x}
                              cy={point.y}
                              r={active ? 13 : node.kind === "project" ? 11 : 8}
                              fill={color}
                              fillOpacity={node.memory?.archived ? 0.35 : 0.82}
                              stroke={active ? "#fff" : color}
                              strokeWidth={active ? 3 : 1.5}
                              strokeDasharray={
                                node.memory?.confirmation_status === "suggested" ? "3 2" : undefined
                              }
                            />
                            <text
                              x={point.x}
                              y={point.y + 24 + (index % 2) * 9}
                              textAnchor="middle"
                              fill="#e2e8f0"
                              fontSize="11"
                              className="pointer-events-none"
                            >
                              {node.label.length > 28 ? `${node.label.slice(0, 26)}…` : node.label}
                            </text>
                            <title>{`${node.kind}: ${node.label}`}</title>
                          </g>
                        );
                      })}
                    </g>
                  </svg>

                  <MindGraphNodeList
                    nodes={filteredNodes}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                </>
              )}
            </div>

            <div
              className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
              aria-label="Graph legend"
            >
              <Legend color="#34d399" label="Confirmed fact" />
              <Legend color="#22d3ee" label="Preference" />
              <Legend color="#c084fc" label="Open task" />
              <Legend color="#a78bfa" label="Decision" />
              <Legend color="#fbbf24" label="Unconfirmed suggestion" />
              <Legend color="#60a5fa" label="Project" />
              <Legend color="#fb923c" label="File / knowledge source" />
              <Legend color="#f472b6" label="Conversation" />
              <Legend color="#f87171" label="Bug / issue" />
              <Legend color="#2dd4bf" label="Verified outcome" />
            </div>
          </section>

          <aside className="space-y-4" aria-label="Selected node details and memory controls">
            <HudPanel title="Memory & consent">
              <div className="flex items-start gap-3">
                {memorySettings?.memory_enabled === false ? (
                  <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                ) : (
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {memorySettings?.memory_enabled === false ? "Memory is off" : "Memory is on"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Turning it off stops collection and retrieval. Existing memories remain until
                    you delete them.
                  </p>
                </div>
              </div>
              <Button
                className="mt-3 min-h-11 w-full"
                variant={memorySettings?.memory_enabled === false ? "default" : "outline"}
                disabled={updateSettings.isPending}
                onClick={() =>
                  void switchMemoryCollection(memorySettings?.memory_enabled === false)
                }
              >
                {memorySettings?.memory_enabled === false ? "Enable memory" : "Disable memory"}
              </Button>
            </HudPanel>

            <HudPanel title="Ask indexed knowledge">
              <div className="space-y-2">
                <input
                  value={knowledgeQuestion}
                  onChange={(event) => setKnowledgeQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void searchKnowledge();
                  }}
                  placeholder="Search approved concepts"
                  aria-label="Search indexed knowledge"
                  className="min-h-11 w-full rounded-md border border-border/60 bg-background/40 px-3 text-sm"
                />
                <Button
                  variant="outline"
                  className="min-h-10 w-full"
                  onClick={() => void searchKnowledge()}
                >
                  Search graph
                </Button>
                {knowledgeAnswer && (
                  <p
                    className="whitespace-pre-line break-words text-xs text-muted-foreground"
                    role="status"
                  >
                    {knowledgeAnswer}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Search returns approved concepts with source type. New extracted suggestions
                  require review.
                </p>
              </div>
            </HudPanel>

            <HudPanel title={`Review extracted concepts (${knowledgeSuggestions.length})`}>
              <Button
                variant="outline"
                className="mb-2 min-h-9 w-full"
                onClick={() => void loadKnowledgeSuggestions()}
              >
                Refresh suggestions
              </Button>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {knowledgeSuggestions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No pending concepts loaded. Index your knowledge, then refresh.
                  </p>
                ) : (
                  knowledgeSuggestions.map((item) => (
                    <div key={item.id} className="rounded-md border border-border/50 p-2">
                      <p className="break-words text-sm">{item.name}</p>
                      <p className="text-xs text-muted-foreground">From {item.source_type}</p>
                      <div className="mt-2 grid grid-cols-3 gap-1">
                        {(["approve", "dismiss", "delete"] as const).map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant={action === "approve" ? "default" : "outline"}
                            onClick={() => void reviewKnowledgeSuggestion(item.id, action)}
                          >
                            {action}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </HudPanel>

            <HudPanel title="Node details">
              {!selectedNode ? (
                <p className="text-sm text-muted-foreground">
                  Select a node to inspect its source, timestamp, confidence, and relationships.
                </p>
              ) : (
                <div className="space-y-3">
                  {editing && selectedMemory ? (
                    <>
                      <textarea
                        value={editingContent}
                        onChange={(event) => setEditingContent(event.target.value)}
                        rows={4}
                        aria-label="Edit memory content"
                        className="w-full rounded-md border border-border/60 bg-background/40 p-2 text-sm outline-none focus:border-primary"
                      />
                      <select
                        value={editingCategory}
                        onChange={(event) =>
                          setEditingCategory(event.target.value as MemoryCategory)
                        }
                        aria-label="Edit memory category"
                        className="min-h-11 w-full rounded-md border border-border/60 bg-background/40 px-2 text-sm"
                      >
                        {MEMORY_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {MEMORY_CATEGORY_LABELS[category]}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <Button
                          className="min-h-10 flex-1"
                          onClick={() => void saveEdit()}
                          disabled={updateMemory.isPending}
                        >
                          <Check className="mr-1 h-4 w-4" /> Save
                        </Button>
                        <Button
                          className="min-h-10"
                          variant="outline"
                          onClick={() => setEditing(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="break-words text-sm leading-relaxed">
                      {selectedNode.description}
                    </p>
                  )}
                  <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">Type</dt>
                    <dd className="capitalize">
                      {selectedNode.kind} · {selectedNode.category}
                    </dd>
                    <dt className="text-muted-foreground">Source</dt>
                    <dd className="break-all">{selectedNode.source}</dd>
                    <dt className="text-muted-foreground">Timestamp</dt>
                    <dd>
                      {selectedNode.timestamp
                        ? new Date(selectedNode.timestamp).toLocaleString()
                        : "—"}
                    </dd>
                    <dt className="text-muted-foreground">Confidence</dt>
                    <dd>
                      {selectedNode.memory
                        ? `${Math.round(selectedNode.confidence * 100)}%`
                        : "Verified record"}
                    </dd>
                    {selectedMemory && (
                      <>
                        <dt className="text-muted-foreground">Review state</dt>
                        <dd>
                          {selectedMemory.confirmation_status === "suggested"
                            ? "Model-inferred suggestion"
                            : "User-confirmed or manually saved"}
                        </dd>
                        <dt className="text-muted-foreground">AI use</dt>
                        <dd>
                          {selectedMemory.confirmation_status === "suggested"
                            ? selectedMemory.use_in_context === false
                              ? "Not allowed"
                              : "Only after confirmation"
                            : selectedMemory.use_in_context === false
                              ? "Disabled"
                              : "Allowed when relevant"}
                        </dd>
                        {selectedMemory.source_conversation_id && (
                          <>
                            <dt className="text-muted-foreground">Conversation</dt>
                            <dd className="break-all">{selectedMemory.source_conversation_id}</dd>
                          </>
                        )}
                      </>
                    )}
                  </dl>

                  {selectedMemory &&
                    issues &&
                    (issues.duplicates.length > 0 || issues.conflicts.length > 0) && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                        <p className="font-medium text-amber-300">Review related information</p>
                        {issues.duplicates.map((memory) => (
                          <p key={memory.id} className="mt-1 text-muted-foreground">
                            Possible duplicate: {memory.content}
                          </p>
                        ))}
                        {issues.conflicts.map((memory) => (
                          <p key={memory.id} className="mt-1 text-muted-foreground">
                            Possible conflict: {memory.content}
                          </p>
                        ))}
                      </div>
                    )}

                  <div className="space-y-1 border-t border-border/40 pt-2">
                    <p className="text-xs font-medium text-muted-foreground">Related nodes</p>
                    {edges
                      .filter(
                        (edge) => edge.from === selectedNode.id || edge.to === selectedNode.id,
                      )
                      .slice(0, 8)
                      .map((edge, index) => {
                        const relatedId = edge.from === selectedNode.id ? edge.to : edge.from;
                        const related = filteredNodes.find((node) => node.id === relatedId);
                        return related ? (
                          <button
                            key={`${relatedId}:${index}`}
                            onClick={() => setSelectedId(related.id)}
                            className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-white/5"
                          >
                            <span className="text-muted-foreground">{edge.relation} · </span>
                            {related.label}
                          </button>
                        ) : null;
                      })}
                    {edges.every(
                      (edge) => edge.from !== selectedNode.id && edge.to !== selectedNode.id,
                    ) && <p className="text-xs text-muted-foreground">No linked nodes yet.</p>}
                  </div>

                  {selectedMemory && !editing && (
                    <div className="space-y-2 border-t border-border/40 pt-3">
                      <label className="block text-xs text-muted-foreground">
                        Project scope
                        <select
                          value={selectedMemory.project_id ?? ""}
                          onChange={(event) =>
                            void updateMemoryField(
                              { projectId: event.target.value || null },
                              "Project scope updated",
                            )
                          }
                          className="mt-1 min-h-11 w-full rounded-md border border-border/60 bg-background/40 px-2 text-sm text-foreground"
                        >
                          <option value="">Personal / unassigned</option>
                          {(projectsQuery.data ?? []).map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {selectedMemory.confirmation_status === "suggested" && (
                          <Button
                            className="min-h-10"
                            onClick={() =>
                              void updateMemoryField(
                                { confirmationStatus: "confirmed" },
                                "Suggestion confirmed",
                              )
                            }
                          >
                            <Check className="mr-1 h-4 w-4" /> Confirm
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          className="min-h-10"
                          onClick={() => {
                            setEditingContent(selectedMemory.content);
                            setEditingCategory(selectedMemory.category);
                            setEditing(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-10"
                          onClick={() =>
                            void updateMemoryField(
                              { pinned: !selectedMemory.pinned },
                              selectedMemory.pinned ? "Memory unpinned" : "Memory pinned",
                            )
                          }
                        >
                          <Pin className="mr-1 h-4 w-4" /> {selectedMemory.pinned ? "Unpin" : "Pin"}
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-10"
                          onClick={() =>
                            void updateMemoryField(
                              { useInContext: selectedMemory.use_in_context === false },
                              selectedMemory.use_in_context === false
                                ? "Memory can be used when relevant"
                                : "Memory excluded from AI context",
                            )
                          }
                        >
                          {selectedMemory.use_in_context === false
                            ? "Allow AI use"
                            : "Exclude from AI"}
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-10"
                          onClick={() => {
                            const nextArchived = !selectedMemory.archived;
                            setShowArchived(nextArchived);
                            void updateMemoryField(
                              { archived: nextArchived },
                              nextArchived ? "Memory archived" : "Memory restored",
                            );
                          }}
                        >
                          {selectedMemory.archived ? (
                            <Archive className="mr-1 h-4 w-4" />
                          ) : (
                            <Archive className="mr-1 h-4 w-4" />
                          )}
                          {selectedMemory.archived ? "Restore" : "Archive"}
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-10 border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={() => void deleteSelected()}
                        >
                          <Trash2 className="mr-1 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </HudPanel>
          </aside>
        </div>
        <p className="text-xs text-muted-foreground">
          Showing up to {MAX_MEMORIES} memories, {MAX_TASKS} tasks, 50 conversations, and 50
          knowledge sources per view. Memory nodes are private to your account; source records are
          loaded through your account-scoped access policies.
        </p>
      </div>
    </AppShell>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
