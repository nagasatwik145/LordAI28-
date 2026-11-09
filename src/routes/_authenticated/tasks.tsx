import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Check, Circle, Edit2, Plus, Save, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/lord/AppShell";
import { HudPanel } from "@/components/lord/HudPanel";
import { supabase } from "@/integrations/supabase/client";
import {
  createTask,
  deleteTask,
  getTaskNotifications,
  markTaskNotificationRead,
  saveTask,
  scheduleTaskReminder,
  useTasks,
  type TaskNotification,
  type TaskPriority,
  type TaskRecord,
} from "@/lib/task-store";
import { isNativeMobile, mobileNotifications } from "@/lib/mobile-native";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({ meta: [{ title: "LORD — Tasks & Notifications" }] }),
  component: TasksPage,
});

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function TasksPage() {
  const { user } = Route.useRouteContext();
  if (!user) throw redirect({ to: "/auth", replace: true });
  const { tasks, loading, error, refresh } = useTasks(user.id);
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDue, setDraftDue] = useState("");
  const [draftPriority, setDraftPriority] = useState<TaskPriority>("med");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshNotifications = useCallback(async () => {
    try {
      setNotifications(await getTaskNotifications(user.id));
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not load notifications.");
      return false;
    }
  }, [user.id]);

  useEffect(() => {
    let active = true;
    const loadNotificationPreference = async () => {
      try {
        const { data, error: settingsError } = await supabase
          .from("user_settings")
          .select("notifications_enabled")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!active) return;
        if (settingsError) {
          console.error("[tasks] notification preference query failed", settingsError);
          setActionError(`Could not load notification preferences: ${settingsError.message}`);
          return;
        }
        if (data) setNotificationsEnabled(data.notifications_enabled);
      } catch (queryError) {
        if (!active) return;
        const message =
          queryError instanceof Error ? queryError.message : "Unexpected Supabase query failure.";
        console.error("[tasks] notification preference request failed", queryError);
        setActionError(`Could not load notification preferences: ${message}`);
      }
    };
    void loadNotificationPreference();
    return () => {
      active = false;
    };
  }, [user.id]);

  useEffect(() => {
    let active = true;
    const timer = window.setInterval(() => {
      void refreshNotifications().then((ok) => {
        if (active && !ok) window.clearInterval(timer);
      });
    }, 60_000);
    void refreshNotifications().then((ok) => {
      if (active && !ok) window.clearInterval(timer);
    });
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user.id, refreshNotifications]);

  useEffect(() => {
    if (!notificationsEnabled) return;
    for (const task of tasks) void scheduleTaskReminder(task, true);
  }, [tasks, notificationsEnabled]);

  const visible = useMemo(
    () => tasks.filter((task) => filter === "all" || (filter === "done" ? task.done : !task.done)),
    [tasks, filter],
  );
  const unreadCount = notifications.filter((notification) => !notification.read_at).length;

  const resetDraft = () => {
    setDraftTitle("");
    setDraftDue("");
    setDraftPriority("med");
    setEditingId(null);
  };
  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const title = draftTitle.trim();
    if (!title) return;
    setBusy(true);
    setActionError("");
    try {
      const due_at = draftDue ? new Date(draftDue).toISOString() : null;
      if (editingId)
        await saveTask(editingId, { title, priority: draftPriority, due_at }, notificationsEnabled);
      else
        await createTask(user.id, { title, priority: draftPriority, due_at }, notificationsEnabled);
      resetDraft();
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not save the task.");
    } finally {
      setBusy(false);
    }
  };
  const edit = (task: TaskRecord) => {
    setEditingId(task.id);
    setDraftTitle(task.title);
    setDraftPriority(task.priority);
    setDraftDue(toLocalInput(task.due_at));
  };
  const updateNotificationPreference = async (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    setActionError("");
    try {
      const { error: saveError } = await supabase
        .from("user_settings")
        .upsert({ user_id: user.id, notifications_enabled: enabled }, { onConflict: "user_id" });
      if (saveError) throw saveError;
      if (enabled && isNativeMobile()) {
        const permission = await mobileNotifications.requestPermissions();
        if (permission.display !== "granted")
          setActionError(
            "Notifications are enabled in LORD AI, but Android permission is not granted. You can allow it in system settings.",
          );
      }
      if (!enabled && isNativeMobile()) {
        const ids = tasks.map((task) => task.reminder_id).filter((id): id is number => id !== null);
        if (ids.length)
          await (
            await import("@capacitor/local-notifications")
          ).LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
      }
    } catch (e) {
      setNotificationsEnabled(!enabled);
      setActionError(e instanceof Error ? e.message : "Could not save notification preferences.");
    }
  };
  const markRead = async (notification: TaskNotification) => {
    try {
      await markTaskNotificationRead(notification.id, !notification.read_at);
      await refreshNotifications();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not update notification.");
    }
  };
  const toggleTask = async (task: TaskRecord) => {
    try {
      await saveTask(task.id, { done: !task.done }, notificationsEnabled);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not update task.");
    }
  };
  const remove = async (task: TaskRecord) => {
    try {
      await deleteTask(task);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not delete task.");
    }
  };

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl tracking-wide gradient-text text-glow sm:text-3xl">
            Tasks & Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan work, set due dates, and keep reminders in one place.
          </p>
        </div>
        <span className="rounded-full border border-border/60 px-3 py-1 text-xs text-muted-foreground">
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </span>
      </div>
      {(error || actionError) && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {actionError || error}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <HudPanel
          title={editingId ? "Edit task" : "Create task"}
          subtitle="Due dates use your current time zone"
        >
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="sr-only">Task title</span>
              <input
                required
                maxLength={240}
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="What needs to get done?"
                className="min-h-11 w-full rounded-md border border-border/60 bg-background/40 px-3 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Due date and time
              <input
                type="datetime-local"
                value={draftDue}
                onChange={(e) => setDraftDue(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border border-border/60 bg-background/40 px-3 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Priority
              <select
                value={draftPriority}
                onChange={(e) => setDraftPriority(e.target.value as TaskPriority)}
                className="mt-1 min-h-11 w-full rounded-md border border-border/60 bg-background/40 px-3 text-sm text-foreground"
              >
                <option value="low">Low</option>
                <option value="med">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button
                disabled={busy}
                className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? "Save task" : "Add task"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetDraft}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border px-4 text-sm"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              )}
            </div>
          </form>
        </HudPanel>
        <HudPanel title="Reminders" subtitle="Due-date notifications">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <Bell className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-medium">Task reminders</p>
                <p className="text-xs text-muted-foreground">
                  In-app reminders and Android notifications
                </p>
              </div>
            </div>
            <button
              role="switch"
              aria-checked={notificationsEnabled}
              onClick={() => void updateNotificationPreference(!notificationsEnabled)}
              className={cn(
                "relative h-6 w-11 rounded-full transition-colors",
                notificationsEnabled ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 h-4 w-4 rounded-full bg-white transition-transform",
                  notificationsEnabled ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {notificationsEnabled
              ? isNativeMobile()
                ? "Android permission is requested when reminders are enabled."
                : "Reminders appear in the app when it is open. Browser background reminders depend on browser support."
              : "Reminders are paused."}
          </p>
        </HudPanel>
        <HudPanel
          title="Task list"
          subtitle={`${tasks.filter((task) => !task.done).length} open · ${tasks.filter((task) => task.done).length} completed`}
          className="xl:col-span-1"
        >
          <div className="mb-3 flex gap-2" role="tablist" aria-label="Task filter">
            {(["open", "all", "done"] as const).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs capitalize",
                  filter === key
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                {key}
              </button>
            ))}
          </div>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading tasks…</p>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center">
              <Circle className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {filter === "done"
                  ? "Completed tasks will show here."
                  : "No tasks yet. Add one above to get started."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {visible.map((task) => (
                <li
                  key={task.id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border border-border/50 bg-background/30 p-3",
                    task.done && "opacity-60",
                  )}
                >
                  <button
                    aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                    onClick={() => void toggleTask(task)}
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-md border",
                      task.done
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-transparent hover:text-primary",
                    )}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("break-words text-sm", task.done && "line-through")}>
                      {task.title}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {task.due_at
                        ? `${new Date(task.due_at).toLocaleString()} · `
                        : "No due date · "}
                      <span
                        className={
                          task.priority === "high"
                            ? "text-destructive"
                            : task.priority === "med"
                              ? "text-primary"
                              : ""
                        }
                      >
                        {task.priority} priority
                      </span>
                    </p>
                  </div>
                  <button
                    aria-label={`Edit ${task.title}`}
                    onClick={() => edit(task)}
                    className="rounded p-2 text-muted-foreground hover:text-foreground"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    aria-label={`Delete ${task.title}`}
                    onClick={() => void remove(task)}
                    className="rounded p-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </HudPanel>
        <HudPanel
          title="Notifications"
          subtitle={`${unreadCount} unread`}
          className="xl:col-span-1"
        >
          {notifications.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center">
              <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Due reminders will appear here.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {notifications.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    "rounded-lg border p-3",
                    item.read_at ? "border-border/40 opacity-70" : "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="break-words text-xs text-muted-foreground">{item.body}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Due {new Date(item.due_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => void markRead(item)}
                      className="shrink-0 rounded px-2 py-1 text-xs text-primary"
                    >
                      {item.read_at ? "Unread" : "Read"}
                    </button>
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
