import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Pin,
  PinOff,
  Search,
  LogOut,
  Loader2,
  Pencil,
  Download,
  ShieldOff,
  ShieldCheck,
  Brain,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/lord/AppShell";
import { HudPanel } from "@/components/lord/HudPanel";
import { supabase } from "@/integrations/supabase/client";
import { emitDashboardEvent } from "@/lib/dashboard-service";
import { cn } from "@/lib/utils";
import {
  MEMORY_CATEGORIES,
  MEMORY_CATEGORY_LABELS,
  type MemoryCategory,
  type MemoryRecord,
  type MemorySettings,
} from "@/lib/memory";
import {
  useMemories,
  useMemorySettings,
  useAddMemory,
  useUpdateMemory,
  useDeleteMemory,
  useClearMemories,
  useUpdateMemorySettings,
} from "@/lib/memory";

export const Route = createFileRoute("/_authenticated/memory")({
  head: () => ({ meta: [{ title: "LORD — Memory" }] }),
  component: MemoryPage,
});

type Filter = "all" | MemoryCategory;

const CATEGORY_STYLES: Record<MemoryCategory, string> = {
  profile: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  preference: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  fact: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  project: "border-purple-500/30 bg-purple-500/10 text-purple-300",
  note: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

function MemoryPage() {
  const qc = useQueryClient();
  const navigate = Route.useNavigate();
  const { user } = Route.useRouteContext();

  const { data: memories = [], isLoading, error } = useMemories(user.id);
  const { data: settings } = useMemorySettings(user.id);

  const addMutation = useAddMemory(user.id);
  const updateMutation = useUpdateMemory(user.id);
  const deleteMutation = useDeleteMemory(user.id);
  const clearMutation = useClearMemories(user.id);
  const settingsMutation = useUpdateMemorySettings(user.id);

  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("profile");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingCategory, setEditingCategory] = useState<MemoryCategory>("note");
  const [showSettings, setShowSettings] = useState(true);

  const memoryEnabled = settings?.memory_enabled ?? true;
  const personalizationEnabled = settings?.personalization_enabled ?? true;

  const filtered = useMemo(
    () =>
      memories
        .filter((m) => filter === "all" || m.category === filter)
        .filter((m) => !search || m.content.toLowerCase().includes(search.toLowerCase()))
        .sort(
          (a, b) =>
            (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [memories, filter, search],
  );

  const addMemory = async () => {
    const text = content.trim();
    if (!text) return;
    try {
      await addMutation.mutateAsync({ content: text, category, source: "manual" });
      setContent("");
      emitDashboardEvent("memory");
      toast.success("Memory stored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save memory");
    }
  };

  const saveEdit = async (id: string) => {
    const text = editingContent.trim();
    if (!text) return;
    try {
      await updateMutation.mutateAsync({ id, content: text, category: editingCategory });
      setEditingId(null);
      emitDashboardEvent("memory");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update memory");
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      emitDashboardEvent("memory");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete memory");
    }
  };

  const togglePin = async (m: MemoryRecord) => {
    try {
      await updateMutation.mutateAsync({ id: m.id, pinned: !m.pinned });
    } catch {
      toast.error("Couldn't update pin");
    }
  };

  const togglePersonalization = async (m: MemoryRecord) => {
    try {
      await updateMutation.mutateAsync({
        id: m.id,
        useInContext: !(m.use_in_context ?? true),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update personalization");
    }
  };

  const approveMemory = async (m: MemoryRecord) => {
    try {
      await updateMutation.mutateAsync({
        id: m.id,
        confirmationStatus: "confirmed",
        useInContext: true,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't approve memory");
    }
  };

  const clearAll = async () => {
    if (!confirm("Delete ALL your memories? This cannot be undone.")) return;
    try {
      await clearMutation.mutateAsync();
      emitDashboardEvent("memory");
      toast.success("All memories cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't clear memories");
    }
  };

  const exportMemories = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      userId: user.id,
      count: memories.length,
      memories: memories.map((m) => ({
        content: m.content,
        category: m.category,
        pinned: m.pinned,
        confidence: m.confidence,
        source: m.source,
        created_at: m.created_at,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lord-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateSetting = async (patch: Partial<Omit<MemorySettings, "user_id" | "updated_at">>) => {
    try {
      await settingsMutation.mutateAsync(patch);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update settings");
    }
  };

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: memories.length };
    for (const cat of MEMORY_CATEGORIES) c[cat] = 0;
    memories.forEach((m) => (c[m.category] = (c[m.category] ?? 0) + 1));
    return c;
  }, [memories]);

  return (
    <AppShell>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl tracking-wide gradient-text text-glow sm:text-3xl">
            Memory
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            LORD remembers what matters · {memories.length} stored · {user.email}
          </p>
        </div>
        <button
          onClick={signOut}
          className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>

      {/* Memory On/Off banner */}
      {!memoryEnabled && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <ShieldOff className="h-4 w-4" />
          Memory collection is off. LORD will not save or use memories. Existing records remain
          stored until you delete them from this page.
        </div>
      )}
      {memoryEnabled && !personalizationEnabled && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <EyeOff className="h-4 w-4" />
          Personalization is paused. Your saved memories remain available here but are not added to
          chat context.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-4">
          <HudPanel title="New Memory">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              disabled={!memoryEnabled}
              placeholder="e.g. My name is Satwik. I prefer dark mode. I'm building LORD AI."
              className="w-full rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
            />
            <div className="mt-2 grid gap-2 sm:flex">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as MemoryCategory)}
                disabled={!memoryEnabled}
                className="min-h-11 flex-1 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-base outline-none sm:text-sm"
              >
                {MEMORY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {MEMORY_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <button
                onClick={addMemory}
                disabled={addMutation.isPending || !content.trim() || !memoryEnabled}
                className="inline-flex min-h-11 items-center justify-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_0_18px_var(--hud)] disabled:opacity-60"
              >
                {addMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}{" "}
                Store
              </button>
            </div>
            {addMutation.error && (
              <p className="mt-2 text-xs text-destructive">
                {(addMutation.error as Error).message}
              </p>
            )}
          </HudPanel>

          <HudPanel
            title="Privacy & Controls"
            action={
              <button
                onClick={() => setShowSettings((s) => !s)}
                className="text-muted-foreground hover:text-primary"
                aria-label="Toggle settings"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
            }
          >
            <div className="flex flex-wrap gap-2">
              <button
                onClick={exportMemories}
                disabled={memories.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" /> Export
              </button>
              <button
                onClick={clearAll}
                disabled={memories.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear all
              </button>
            </div>

            {showSettings && (
              <div className="mt-4 space-y-3 border-t border-border/30 pt-4">
                <ToggleRow
                  icon={memoryEnabled ? ShieldCheck : ShieldOff}
                  label="Memory collection"
                  description="Allow LORD to save new memories from chats or manual entry"
                  checked={memoryEnabled}
                  onChange={(v) => updateSetting({ memory_enabled: v })}
                />
                <ToggleRow
                  icon={personalizationEnabled ? Eye : EyeOff}
                  label="Use memories in chat"
                  description="Pause or resume relevant saved context in your chats"
                  checked={personalizationEnabled}
                  disabled={!memoryEnabled}
                  onChange={(v) => updateSetting({ personalization_enabled: v })}
                />
                <ToggleRow
                  icon={Brain}
                  label="Auto-save"
                  description="Save high-confidence memories without asking"
                  checked={settings?.auto_save ?? true}
                  disabled={!memoryEnabled}
                  onChange={(v) => updateSetting({ auto_save: v })}
                />
                <ToggleRow
                  icon={ShieldCheck}
                  label="Ask before saving"
                  description="Confirm lower-confidence memories first"
                  checked={settings?.ask_before_save ?? true}
                  disabled={!memoryEnabled}
                  onChange={(v) => updateSetting({ ask_before_save: v })}
                />
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Confidence threshold</span>
                    <span className="font-mono text-foreground">
                      {(settings?.confidence_threshold ?? 0.65).toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={0.95}
                    step={0.05}
                    value={settings?.confidence_threshold ?? 0.65}
                    disabled={!memoryEnabled}
                    onChange={(e) =>
                      updateSetting({ confidence_threshold: Number(e.target.value) })
                    }
                    className="mt-1 w-full accent-[color:var(--hud)]"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Memories scored below this are offered for confirmation; at or above are
                    auto-saved (if Auto-save is on).
                  </p>
                </div>
              </div>
            )}
            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
              Deleting a memory removes it from LORD&apos;s active memory records and
              personalization. This does not delete the conversation it came from, and provider
              backups may retain data according to their retention policies.
            </p>
          </HudPanel>
        </div>

        <HudPanel
          title="Vault"
          action={
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="min-h-9 w-full rounded-md border border-border/60 bg-background/40 py-1.5 pl-8 pr-2 text-xs outline-none focus:border-primary sm:w-auto"
              />
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap gap-1">
            {(["all", ...MEMORY_CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs uppercase tracking-wider transition",
                  filter === c
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:text-primary",
                )}
              >
                {c}
                <span className="ml-1 opacity-60">{counts[c] ?? 0}</span>
              </button>
            ))}
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-destructive">{(error as Error).message}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {memories.length === 0
                ? "No memories yet. Tell LORD something about yourself, or add one above."
                : "No memories match your filter."}
            </p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((m) => (
                <li
                  key={m.id}
                  className={cn(
                    "group rounded-md border bg-background/30 p-3",
                    m.pinned
                      ? "border-primary/60 shadow-[0_0_12px_var(--hud)]"
                      : "border-border/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    {editingId === m.id ? (
                      <div className="flex-1 space-y-2">
                        <textarea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          rows={3}
                          className="w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-sm outline-none focus:border-primary"
                        />
                        <select
                          value={editingCategory}
                          onChange={(e) => setEditingCategory(e.target.value as MemoryCategory)}
                          className="w-full rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-sm outline-none"
                        >
                          {MEMORY_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {MEMORY_CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEdit(m.id)}
                            disabled={updateMutation.isPending || !editingContent.trim()}
                            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-md border border-border/60 px-3 py-1.5 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm">{m.content}</p>
                        <div className="flex shrink-0 gap-1 opacity-60 group-hover:opacity-100">
                          <button
                            onClick={() => togglePin(m)}
                            className="text-muted-foreground hover:text-primary"
                            aria-label="Pin"
                          >
                            {m.pinned ? (
                              <Pin className="h-4 w-4 text-primary" />
                            ) : (
                              <PinOff className="h-4 w-4" />
                            )}
                          </button>
                          {m.confirmation_status === "suggested" && (
                            <button
                              onClick={() => void approveMemory(m)}
                              className="text-muted-foreground hover:text-primary"
                              aria-label="Approve memory"
                              title="Approve memory captured from chat"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => void togglePersonalization(m)}
                            className="text-muted-foreground hover:text-primary"
                            aria-label={
                              m.use_in_context === false
                                ? "Include in personalization"
                                : "Exclude from personalization"
                            }
                            title={
                              m.use_in_context === false
                                ? "Include in personalization"
                                : "Exclude from personalization"
                            }
                          >
                            {m.use_in_context === false ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(m.id);
                              setEditingContent(m.content);
                              setEditingCategory(m.category);
                            }}
                            className="text-muted-foreground hover:text-primary"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => remove(m.id)}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5",
                        CATEGORY_STYLES[m.category] ?? CATEGORY_STYLES.note,
                      )}
                    >
                      {m.category}
                    </span>
                    {m.source === "auto" && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                        {m.confirmation_status === "suggested"
                          ? "captured from chat · approval needed"
                          : "captured from chat"}
                      </span>
                    )}
                    {m.source !== "auto" && (
                      <span className="rounded bg-muted/60 px-1.5 py-0.5">
                        {m.source === "imported" ? "imported" : "added by you"}
                      </span>
                    )}
                    <span>{m.project_id ? "project-specific" : "all projects"}</span>
                    {m.use_in_context === false && <span>excluded from personalization</span>}
                    {m.confidence < 1 && (
                      <span title="Memory confidence">{(m.confidence * 100).toFixed(0)}%</span>
                    )}
                    <span>{new Date(m.created_at).toLocaleDateString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </HudPanel>
      </div>
    </AppShell>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: typeof ShieldCheck;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm">{label}</p>
          <p className="text-[10px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-primary" : "bg-border/60",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
