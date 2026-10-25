import * as React from "react";
import { Link } from "@tanstack/react-router";
import { addDays, format, isWithinInterval, parseISO, startOfDay } from "date-fns";
import { Bell, CalendarDays, Check, Clock3, Search, Target } from "lucide-react";
import { useCalendar } from "@/components/lord/CalendarProvider";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { listFocusSessions, summarizeFocusSessions } from "@/lib/learning/focus-sessions";
import {
  useTasks,
  saveTask,
  getTaskNotifications,
  markTaskNotificationRead,
  type TaskNotification,
} from "@/lib/task-store";
import { GlassCard, SectionTitle, EmptyHint } from "./ui";

type Mission = {
  id: string;
  objective: string;
  status: string;
  updatedAt?: string;
  updated_at?: string;
};

export function PersonalDashboard({ userId }: { userId: string }) {
  const { events } = useCalendar();
  const { tasks, loading, error, refresh } = useTasks(userId);
  const [notifications, setNotifications] = React.useState<TaskNotification[]>([]);
  const [studyMinutes, setStudyMinutes] = React.useState<number | null>(null);
  const [missions, setMissions] = React.useState<Mission[]>([]);
  const [missionError, setMissionError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [view, setView] = React.useState<"day" | "week">("day");
  const [failure, setFailure] = React.useState("");
  const now = new Date();
  const from = startOfDay(now);
  const through = view === "day" ? addDays(from, 1) : addDays(from, 7);
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());

  React.useEffect(() => {
    let active = true;
    const loadPersonalData = async () => {
      try {
        const [notes, focusSessions] = await Promise.all([
          getTaskNotifications(userId),
          listFocusSessions(),
        ]);
        if (!active) return;
        setNotifications(notes);
        setStudyMinutes(Math.round(summarizeFocusSessions(focusSessions).todaySeconds / 60));
      } catch (e) {
        if (active)
          setFailure(e instanceof Error ? e.message : "Could not load study or notification data.");
      }
    };
    const loadMissions = async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const missionsResponse = await fetch("/api/missions", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "include",
        });
        if (!missionsResponse.ok)
          throw new Error(
            missionsResponse.status === 403
              ? "Mission access requires LORD Pro."
              : "Could not load missions.",
          );
        const payload = (await missionsResponse.json()) as { missions?: Mission[] };
        if (active)
          setMissions(
            (payload.missions ?? []).filter((m) =>
              [
                "planning",
                "needs_clarification",
                "needs_approval",
                "planned",
                "running",
                "paused",
              ].includes(m.status),
            ),
          );
      } catch (e) {
        if (active)
          setMissionError(
            e instanceof Error ? e.message : "Some dashboard data could not be loaded.",
          );
      }
    };
    void loadPersonalData();
    void loadMissions();
    return () => {
      active = false;
    };
  }, [userId]);

  const upcoming = events
    .filter((e) => {
      const date = parseISO(e.date);
      return (
        !e.completed &&
        Number.isFinite(date.getTime()) &&
        isWithinInterval(date, { start: from, end: through }) &&
        matches(`${e.title} ${e.category}`)
      );
    })
    .sort((a, b) =>
      `${a.date}T${a.startTime ?? "00:00"}`.localeCompare(`${b.date}T${b.startTime ?? "00:00"}`),
    );
  const due = tasks
    .filter(
      (t) =>
        !t.done &&
        t.due_at &&
        new Date(t.due_at) >= from &&
        new Date(t.due_at) < through &&
        matches(t.title),
    )
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  const priorities = tasks
    .filter(
      (t) =>
        !t.done &&
        (t.priority === "high" || (t.due_at && new Date(t.due_at) < through)) &&
        matches(t.title),
    )
    .slice(0, 6);
  const activeMissions = missions.filter((m) => matches(m.objective));
  const recent = notifications.slice(0, 5);
  const completeToday = tasks.filter(
    (t) => t.done && new Date(t.updated_at).toDateString() === now.toDateString(),
  ).length;

  const toggleRead = async (item: TaskNotification) => {
    try {
      await markTaskNotificationRead(item.id, !item.read_at);
      setNotifications(await getTaskNotifications(userId));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not update notification.");
    }
  };
  const postpone = async (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task?.due_at) return;
    try {
      await saveTask(task.id, { due_at: addDays(new Date(task.due_at), 1).toISOString() }, true);
      await refresh();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not postpone task.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{format(now, "EEEE, MMMM d")}</p>
          <SectionTitle hint="your schedule and work">PERSONAL COMMAND CENTER</SectionTitle>
        </div>
        <div className="flex gap-2" role="group" aria-label="Dashboard date range">
          {(["day", "week"] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={view === item ? "default" : "outline"}
              onClick={() => setView(item)}
            >
              {item === "day" ? "Today" : "This week"}
            </Button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 rounded-xl border border-border bg-card/50 px-3">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          aria-label="Search dashboard"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks, events, missions…"
          className="min-h-11 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {(failure || error || missionError) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {failure || error || missionError}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        <GlassCard className="p-4">
          <SectionTitle hint={`${priorities.length} shown`}>TODAY'S PRIORITIES</SectionTitle>
          {priorities.length ? (
            <ul className="space-y-2">
              {priorities.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 p-3"
                >
                  <span className="min-w-0 flex-1 text-sm">{t.title}</span>
                  <span className="text-xs text-primary">{t.priority}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Complete ${t.title}`}
                    onClick={async () => {
                      try {
                        await saveTask(t.id, { done: true }, true);
                        await refresh();
                      } catch (e) {
                        setFailure(e instanceof Error ? e.message : "Could not update task.");
                      }
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint>
              No priorities match this view.{" "}
              <Link to="/tasks" className="text-primary underline">
                Add a task
              </Link>
            </EmptyHint>
          )}
        </GlassCard>
        <GlassCard className="p-4">
          <SectionTitle hint={`${upcoming.length} scheduled`}>
            UPCOMING EVENTS & STUDY BLOCKS
          </SectionTitle>
          {upcoming.length ? (
            <ul className="space-y-2">
              {upcoming.slice(0, 6).map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 p-3"
                >
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{e.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(e.date), "EEE, MMM d")}
                      {e.startTime ? ` · ${e.startTime}` : ""} · {e.category}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint>
              No events or study blocks scheduled.{" "}
              <Link to="/calendar" className="text-primary underline">
                Open calendar
              </Link>
            </EmptyHint>
          )}
          <Link to="/calendar" className="mt-3 inline-block text-xs text-primary underline">
            Open calendar
          </Link>
        </GlassCard>
        <GlassCard className="p-4">
          <SectionTitle hint={`${activeMissions.length} active`}>ACTIVE MISSIONS</SectionTitle>
          {missionError ? (
            <EmptyHint>{missionError}</EmptyHint>
          ) : activeMissions.length ? (
            <ul className="space-y-2">
              {activeMissions.slice(0, 5).map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 p-3"
                >
                  <Target className="h-4 w-4 text-primary" />
                  <span className="min-w-0 flex-1 text-sm">{m.objective}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.status.replaceAll("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint>
              No active missions.{" "}
              <Link to="/command-center" className="text-primary underline">
                Open LORD
              </Link>
            </EmptyHint>
          )}
          <Link to="/command-center" className="mt-3 inline-block text-xs text-primary underline">
            Open mission controls
          </Link>
        </GlassCard>
        <GlassCard className="p-4">
          <SectionTitle hint={`${due.length} due`}>TASKS DUE SOON</SectionTitle>
          {loading ? (
            <EmptyHint>Loading tasks…</EmptyHint>
          ) : due.length ? (
            <ul className="space-y-2">
              {due.slice(0, 6).map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 p-3"
                >
                  <Clock3 className="h-4 w-4 text-primary" />
                  <span className="min-w-0 flex-1 text-sm">
                    {t.title}
                    <span className="block text-xs text-muted-foreground">
                      {new Date(t.due_at!).toLocaleString()}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void postpone(t.id)}>
                    +1 day
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint>
              No tasks due in this period.{" "}
              <Link to="/tasks" className="text-primary underline">
                Open tasks
              </Link>
            </EmptyHint>
          )}
          <Link to="/tasks" className="mt-3 inline-block text-xs text-primary underline">
            Open tasks
          </Link>
        </GlassCard>
        <GlassCard className="p-4">
          <SectionTitle hint="latest first">RECENT NOTIFICATIONS</SectionTitle>
          {recent.length ? (
            <ul className="space-y-2">
              {recent.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start gap-2 rounded-lg border border-border/60 p-3"
                >
                  <Bell className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{n.title}</p>
                    <p className="break-words text-xs text-muted-foreground">{n.body}</p>
                  </div>
                  <button
                    className="text-xs text-primary underline"
                    onClick={() => void toggleRead(n)}
                  >
                    {n.read_at ? "Unread" : "Read"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint>
              No recent notifications.{" "}
              <Link to="/tasks" className="text-primary underline">
                Manage notifications
              </Link>
            </EmptyHint>
          )}
          <Link to="/tasks" className="mt-3 inline-block text-xs text-primary underline">
            Manage notifications
          </Link>
        </GlassCard>
        <GlassCard className="p-4">
          <SectionTitle hint="based on your records">QUICK ACTIONS & SUMMARY</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <Link to="/tasks">
              <Button size="sm">New task</Button>
            </Link>
            <Link to="/calendar">
              <Button size="sm" variant="outline">
                Add event
              </Button>
            </Link>
            <Link to="/study">
              <Button size="sm" variant="outline">
                Study
              </Button>
            </Link>
            <Link to="/chat">
              <Button size="sm" variant="outline">
                Plan a mission
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Completed today: <strong className="text-foreground">{completeToday} tasks</strong> ·
            Study today:{" "}
            <strong className="text-foreground">
              {studyMinutes === null ? "—" : `${studyMinutes} min`}
            </strong>{" "}
            · Open tasks:{" "}
            <strong className="text-foreground">{tasks.filter((t) => !t.done).length}</strong> ·
            Unread alerts:{" "}
            <strong className="text-foreground">
              {notifications.filter((n) => !n.read_at).length}
            </strong>
          </p>
        </GlassCard>
      </div>
    </div>
  );
}
