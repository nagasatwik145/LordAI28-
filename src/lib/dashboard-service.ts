import { store, type CalendarEvent, type Task, type Memory } from "@/lib/lord-store";
import { supabase } from "@/integrations/supabase/client";
import { monitoring } from "@/lib/monitoring-service";
import { DEFAULT_MODEL_ID, MODEL_REGISTRY } from "@/lib/ai/models";
import { DEFAULT_MODE } from "@/lib/modes";
import { getApiBaseUrl } from "@/lib/api-config";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export type DashboardEventKind =
  | "system"
  | "tasks"
  | "calendar"
  | "memory"
  | "conversations"
  | "research"
  | "ai"
  | "notifications"
  | "all";

type BusListener = (kind: DashboardEventKind) => void;

const busListeners = new Set<BusListener>();

export function emitDashboardEvent(kind: DashboardEventKind) {
  if (typeof window === "undefined") return;
  busListeners.forEach((l) => l(kind));
}

export function onDashboardEvent(listener: BusListener): () => void {
  busListeners.add(listener);
  return () => busListeners.delete(listener);
}

export interface DashboardConversation {
  id: string;
  title: string;
  preview: string;
  lastActivity: number;
  createdAt: number;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
}

export interface DashboardConversations {
  items: DashboardConversation[];
  total: number;
  pinnedCount: number;
  archivedCount: number;
  lastActivity: number | null;
  requiresAuth: boolean;
}

export interface DashboardTasks {
  pending: number;
  completed: number;
  overdue: number;
  dueToday: number;
  total: number;
  items: Array<Pick<Task, "id" | "title" | "priority" | "due">>;
}

export interface DashboardCalendar {
  todays: CalendarEvent[];
  tomorrow: CalendarEvent[];
  upcoming: CalendarEvent[];
  nextReminder: CalendarEvent | null;
  daysRemaining: number | null;
  hasEvents: boolean;
}

export interface DashboardMemory {
  stored: number;
  important: number;
  recentlyLearned: number;
  lastUpdated: number | null;
  usagePct: number;
  source: "supabase" | "local";
}

export interface DashboardResearchSession {
  id: string;
  title: string;
  status: "running" | "completed";
  documents: number;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardResearch {
  current: number;
  completed: number;
  savedDocuments: number;
  total: number;
  sessions: DashboardResearchSession[];
}

export interface DashboardAIModel {
  id: string;
  label: string;
  provider: string;
  available: boolean;
}

export interface DashboardAI {
  openRouterAvailable: boolean;
  localAvailable: boolean;
  providerStatus:
    | "available"
    | "missing_credentials"
    | "invalid_credentials"
    | "rate_limited"
    | "timeout"
    | "unavailable";
  activeModel: string | null;
  activeMode: string;
  lastSuccessfulRequest: number | null;
  failedRequests: number;
  rateLimited: boolean;
  health: "healthy" | "degraded" | "offline";
  models: DashboardAIModel[];
}

export interface DashboardSystem {
  engine: "online" | "offline" | "initializing" | "maintenance";
  latencyMs: number | null;
  uptimeSeconds: number;
  uptimeLabel: string;
  startTime: number;
  healthScore: number;
  healthStatus: "healthy" | "warning" | "critical";
}

export interface DashboardNotification {
  id: string;
  type: string;
  message: string;
  timestamp: number;
  severity: "info" | "success" | "warning" | "error";
}

export interface DashboardNotifications {
  items: DashboardNotification[];
  unread: number;
}

export interface DashboardData {
  system: DashboardSystem;
  tasks: DashboardTasks;
  calendar: DashboardCalendar;
  memory: DashboardMemory;
  conversations: DashboardConversations;
  research: DashboardResearch;
  ai: DashboardAI;
  notifications: DashboardNotifications;
}

export function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

async function pingBackend(): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const base = getApiBaseUrl() || "";
    const res = await fetch(`${base}/api/health`, { method: "GET", cache: "no-store" });
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: Date.now() - start };
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export async function fetchConversations(userId: string | null): Promise<DashboardConversations> {
  const empty: DashboardConversations = {
    items: [],
    total: 0,
    pinnedCount: 0,
    archivedCount: 0,
    lastActivity: null,
    requiresAuth: !!userId === false,
  };
  if (!userId) return { ...empty, requiresAuth: true };

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("last_message_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    created_at: string;
    last_message_at: string;
  }>;
  if (rows.length === 0) {
    return {
      items: [],
      total: 0,
      pinnedCount: 0,
      archivedCount: 0,
      lastActivity: null,
      requiresAuth: false,
    };
  }

  const ids = rows.map((r) => r.id);
  const { data: msgData } = await supabase
    .from("messages")
    .select("conversation_id, role, content, created_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: true })
    .limit(500);

  const byConv = new Map<string, Array<{ role: string; content: string }>>();
  for (const m of (msgData ?? []) as Array<{
    conversation_id: string;
    role: string;
    content: string;
  }>) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id)!.push({ role: m.role, content: m.content });
  }

  const items: DashboardConversation[] = rows.map((r) => {
    const msgs = byConv.get(r.id) ?? [];
    const firstUser = msgs.find((m) => m.role === "user");
    const preview = firstUser
      ? firstUser.content.replace(/\s+/g, " ").slice(0, 120)
      : "No messages yet";
    return {
      id: r.id,
      title: r.title || "Untitled conversation",
      preview,
      lastActivity: new Date(r.last_message_at).getTime(),
      createdAt: new Date(r.created_at).getTime(),
      messageCount: msgs.length,
      pinned: false,
      archived: false,
    };
  });

  const lastActivity = items.reduce((max, c) => (c.lastActivity > max ? c.lastActivity : max), 0);

  return {
    items,
    total: items.length,
    pinnedCount: items.filter((c) => c.pinned).length,
    archivedCount: items.filter((c) => c.archived).length,
    lastActivity: lastActivity || null,
    requiresAuth: false,
  };
}

export async function fetchTasks(userId: string | null): Promise<DashboardTasks> {
  if (!userId) return { pending: 0, completed: 0, overdue: 0, dueToday: 0, total: 0, items: [] };
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, done, priority, due_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const tasks = data ?? [];
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dueDayKey = (value: string) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  let pending = 0;
  let completed = 0;
  let overdue = 0;
  let dueToday = 0;
  for (const t of tasks) {
    if (t.done) {
      completed++;
      continue;
    }
    pending++;
    if (t.due_at) {
      const dueKey = dueDayKey(t.due_at);
      if (dueKey < todayKey) overdue++;
      else if (dueKey === todayKey) dueToday++;
    }
  }
  const items = tasks
    .filter((task) => !task.done)
    .sort((a, b) => {
      if (!a.due_at) return b.due_at ? 1 : a.created_at.localeCompare(b.created_at);
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    })
    .slice(0, 4)
    .map(({ id, title, priority, due_at }) => ({ id, title, priority, due: due_at ?? undefined }));
  return { pending, completed, overdue, dueToday, total: tasks.length, items };
}

export async function fetchCalendar(): Promise<DashboardCalendar> {
  const events = store.get<CalendarEvent[]>("calendar-events", []);
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = startOfDay(new Date(now.getTime() + 86400000));
  const horizon = new Date(now.getTime() + 7 * 86400000);

  const todays = events.filter((e) => !e.completed && isSameDay(new Date(e.date), today));
  const tomorrowEv = events.filter((e) => !e.completed && isSameDay(new Date(e.date), tomorrow));
  const upcoming = events
    .filter((e) => {
      const d = new Date(e.date);
      return !e.completed && d > tomorrow && d <= horizon;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const future = events
    .filter((e) => !e.completed && new Date(e.date) >= today)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const next = future[0] ?? null;
  const daysRemaining = next
    ? Math.ceil((startOfDay(new Date(next.date)).getTime() - today.getTime()) / 86400000)
    : null;

  const reminders = events
    .filter((e) => e.reminder && new Date(e.reminder).getTime() >= Date.now())
    .sort((a, b) => new Date(a.reminder!).getTime() - new Date(b.reminder!).getTime());

  return {
    todays,
    tomorrow: tomorrowEv,
    upcoming,
    nextReminder: reminders[0] ?? null,
    daysRemaining,
    hasEvents: events.length > 0,
  };
}

export async function fetchMemory(userId: string | null): Promise<DashboardMemory> {
  const DAY = 86400000;
  if (userId) {
    const { data, error } = await supabase
      .from("memories")
      .select("created_at, updated_at, pinned")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as Array<{ created_at: string; updated_at: string; pinned: boolean }>;
    const stored = rows.length;
    const important = rows.filter((r) => r.pinned).length;
    const recentlyLearned = rows.filter(
      (r) => Date.now() - new Date(r.created_at).getTime() < DAY,
    ).length;
    const lastUpdated = rows.reduce((max, r) => Math.max(max, new Date(r.updated_at).getTime()), 0);
    return {
      stored,
      important,
      recentlyLearned,
      lastUpdated: lastUpdated || null,
      usagePct: Math.min(100, Math.round((stored / 200) * 100)),
      source: "supabase",
    };
  }

  const local = store.get<Memory[]>("memories", []);
  const stored = local.length;
  const important = local.filter((m) => m.pinned).length;
  const recentlyLearned = local.filter((m) => Date.now() - m.createdAt < DAY).length;
  const lastUpdated = local.reduce((max, m) => Math.max(max, m.createdAt), 0);
  return {
    stored,
    important,
    recentlyLearned,
    lastUpdated: lastUpdated || null,
    usagePct: Math.min(100, Math.round((stored / 200) * 100)),
    source: "local",
  };
}

export async function fetchResearch(): Promise<DashboardResearch> {
  const raw = store.get<DashboardResearchSession[]>("research-sessions", []);
  const sessions = [...raw].sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    current: sessions.filter((s) => s.status === "running").length,
    completed: sessions.filter((s) => s.status === "completed").length,
    savedDocuments: sessions.reduce((sum, s) => sum + s.documents, 0),
    total: sessions.length,
    sessions: sessions.slice(0, 10),
  };
}

export async function fetchSystem(): Promise<DashboardSystem> {
  const { ok, latencyMs } = await pingBackend();
  const metrics = monitoring.getMetrics();
  const uptimeSeconds = Math.floor((Date.now() - monitoring.getStartTime()) / 1000);
  return {
    engine: ok ? "online" : "offline",
    latencyMs: ok ? latencyMs : null,
    uptimeSeconds,
    uptimeLabel: formatUptime(uptimeSeconds),
    startTime: monitoring.getStartTime(),
    healthScore: metrics.healthScore,
    healthStatus: monitoring.getHealthStatus(),
  };
}

export async function fetchAI(): Promise<DashboardAI> {
  const metrics = monitoring.getMetrics();
  let providerStatus: DashboardAI["providerStatus"] = "unavailable";
  let availableModelIds = new Set<string>();
  try {
    const base = getApiBaseUrl();
    const response = await authenticatedFetch(`${base}/api/openrouter-test`, {
      cache: "no-store",
    });
    const result: unknown = await response.json();
    if (result && typeof result === "object") {
      const value = result as { status?: unknown; modelIds?: unknown };
      if (
        value.status === "available" ||
        value.status === "missing_credentials" ||
        value.status === "invalid_credentials" ||
        value.status === "rate_limited" ||
        value.status === "timeout" ||
        value.status === "unavailable"
      ) {
        providerStatus = value.status;
      }
      if (Array.isArray(value.modelIds)) {
        availableModelIds = new Set(
          value.modelIds.filter((id): id is string => typeof id === "string"),
        );
      }
    }
  } catch {
    providerStatus = "unavailable";
  }
  const openRouterAvailable = providerStatus === "available";

  const mode = store.get("chat-mode", DEFAULT_MODE);
  const activeModelLabel = MODEL_REGISTRY.find((m) => m.id === DEFAULT_MODEL_ID)?.label ?? null;

  const models: DashboardAIModel[] = MODEL_REGISTRY.filter((m) => m.provider === "openrouter").map(
    (m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      available: availableModelIds.has(m.id),
    }),
  );

  const health: DashboardAI["health"] =
    providerStatus === "available"
      ? "healthy"
      : providerStatus === "missing_credentials" || providerStatus === "invalid_credentials"
        ? "offline"
        : "degraded";

  return {
    openRouterAvailable,
    localAvailable: false,
    providerStatus,
    activeModel: activeModelLabel,
    activeMode: mode,
    lastSuccessfulRequest: monitoring.getLastSuccessAt(),
    failedRequests: monitoring.getFailedRequests(),
    rateLimited: monitoring.isRateLimited(),
    health,
    models,
  };
}

export async function fetchNotifications(): Promise<DashboardNotifications> {
  const events = monitoring.getRecentEvents(20);
  const items: DashboardNotification[] = events.map((e) => ({
    id: e.id,
    type: e.category,
    message: e.message,
    timestamp: e.timestamp,
    severity:
      e.type === "error"
        ? "error"
        : e.type === "warning"
          ? "warning"
          : e.type === "action"
            ? "success"
            : "info",
  }));
  const unread = items.filter((i) => i.severity === "error" || i.severity === "warning").length;
  return { items, unread };
}

export async function fetchDashboard(userId: string | null): Promise<DashboardData> {
  const [system, tasks, calendar, memory, conversations, research, ai, notifications] =
    await Promise.all([
      fetchSystem(),
      fetchTasks(userId),
      fetchCalendar(),
      fetchMemory(userId),
      fetchConversations(userId),
      fetchResearch(),
      fetchAI(),
      fetchNotifications(),
    ]);
  return { system, tasks, calendar, memory, conversations, research, ai, notifications };
}
