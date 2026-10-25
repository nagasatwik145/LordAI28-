import * as React from "react";
import { Link } from "@tanstack/react-router";
import { addDays, format, isSameDay, parseISO, startOfDay } from "date-fns";
import { Bell, CalendarDays, Check, Clock3, ExternalLink, Sparkles, X } from "lucide-react";
import { useCalendar } from "@/components/lord/CalendarProvider";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useTasks, saveTask, type TaskRecord } from "@/lib/task-store";
import { listFocusSessions, summarizeFocusSessions } from "@/lib/learning/focus-sessions";
import { isNativeMobile, mobileNotifications } from "@/lib/mobile-native";
import { isTaskDueOnDate, isTaskOverdue, rankBriefingTask } from "@/lib/daily-briefing";
import { GlassCard, SectionTitle } from "./ui";

type BriefingSettings = {
  briefing_enabled: boolean;
  briefing_time: string;
  briefing_timezone: string;
  briefing_dismissed: string[];
  briefing_focus: string;
};
type ProjectActivity = { id: string; action: string; entity_type: string; created_at: string };
const DEFAULT_SETTINGS: BriefingSettings = {
  briefing_enabled: false,
  briefing_time: "08:00:00",
  briefing_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  briefing_dismissed: [],
  briefing_focus: "",
};
const BRIEFING_NOTIFICATION_ID = 2_143_000_001;

export function DailyBriefingDashboard({ userId }: { userId: string }) {
  const { events, toggleComplete } = useCalendar();
  const { tasks, loading, error, refresh } = useTasks(userId);
  const [date, setDate] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [settings, setSettings] = React.useState(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [studyMinutes, setStudyMinutes] = React.useState<number | null>(null);
  const [activity, setActivity] = React.useState<ProjectActivity[]>([]);
  const selected = parseISO(date);
  const dayStart = startOfDay(selected);
  const openTasks = tasks.filter((task) => !task.done);
  const overdue = openTasks.filter((task) => isTaskOverdue(task, new Date()));
  const dayTasks = openTasks.filter((task) => isTaskDueOnDate(task, selected));
  const dayEvents = events
    .filter((event) => event.date === date && !event.completed)
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const suggestions = [...openTasks]
    .sort(
      (a, b) =>
        rankBriefingTask(b, selected, settings.briefing_focus) -
        rankBriefingTask(a, selected, settings.briefing_focus),
    )
    .filter((task) => !settings.briefing_dismissed.includes(task.id))
    .slice(0, 5);
  const accomplished = tasks.filter(
    (task) => task.done && isSameDay(new Date(task.updated_at), addDays(selected, -1)),
  );

  React.useEffect(() => {
    let active = true;
    void supabase
      .from("user_settings")
      .select("briefing_enabled,briefing_time,briefing_timezone,briefing_dismissed,briefing_focus")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) setMessage(`Could not load briefing settings: ${loadError.message}`);
        else if (data)
          setSettings({
            ...DEFAULT_SETTINGS,
            ...data,
            briefing_dismissed: Array.isArray(data.briefing_dismissed)
              ? data.briefing_dismissed.filter(
                  (value): value is string => typeof value === "string",
                )
              : [],
          });
        setSettingsReady(true);
      });
    void listFocusSessions()
      .then((sessions) => {
        if (active) setStudyMinutes(Math.round(summarizeFocusSessions(sessions).todaySeconds / 60));
      })
      .catch(() => undefined);
    void supabase
      .from("project_activity")
      .select("id,action,entity_type,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (active) setActivity(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const persist = async (next: BriefingSettings) => {
    setSaving(true);
    const { error: saveError } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, ...next }, { onConflict: "user_id" });
    setSaving(false);
    if (saveError) {
      setMessage(`Could not save briefing settings: ${saveError.message}`);
      return false;
    }
    setSettings(next);
    setMessage("Settings saved.");
    return true;
  };

  const scheduleNativeReminder = async (next: BriefingSettings) => {
    await mobileNotifications.cancel(BRIEFING_NOTIFICATION_ID).catch(() => undefined);
    const [hour, minute] = next.briefing_time.split(":").map(Number);
    const at = new Date();
    at.setHours(hour, minute, 0, 0);
    if (at <= new Date()) at.setDate(at.getDate() + 1);
    const result = await mobileNotifications.scheduleReminder(
      "Your LORD daily briefing",
      "See today's tasks, events, and suggested next actions.",
      at,
      "/command-center",
      BRIEFING_NOTIFICATION_ID,
      true,
    );
    return result.scheduled;
  };

  const toggleReminder = async (enabled: boolean) => {
    if (enabled && !isNativeMobile()) {
      setMessage(
        "This browser cannot schedule background reminders. Open LORD on Android to enable a device reminder.",
      );
      return;
    }
    if (enabled && isNativeMobile()) {
      const permission = await mobileNotifications.requestPermissions();
      if (permission.display !== "granted") {
        setMessage(
          "Notification permission was not granted. Allow it in Android settings, then try again.",
        );
        return;
      }
    }
    const next = {
      ...settings,
      briefing_enabled: enabled,
      briefing_timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || settings.briefing_timezone,
    };
    if (!(await persist(next))) return;
    try {
      if (enabled) {
        if (!(await scheduleNativeReminder(next))) {
          await persist({ ...next, briefing_enabled: false });
          setMessage(
            "Android did not schedule the reminder. Check notification permission and try again.",
          );
        } else setMessage("Daily reminder scheduled on this device.");
      } else {
        await mobileNotifications.cancel(BRIEFING_NOTIFICATION_ID).catch(() => undefined);
        setMessage("Daily reminder disabled.");
      }
    } catch {
      setMessage(
        "Reminder scheduling failed. Your settings are saved; try again when the device is online.",
      );
    }
  };

  const completeTask = async (task: TaskRecord) => {
    try {
      await saveTask(task.id, { done: true }, false);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not complete task.");
    }
  };
  const postpone = async (task: TaskRecord) => {
    if (!task.due_at) return;
    try {
      await saveTask(task.id, { due_at: addDays(new Date(task.due_at), 1).toISOString() }, true);
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not postpone task.");
    }
  };
  const dismiss = async (task: TaskRecord) => {
    const next = { ...settings, briefing_dismissed: [...settings.briefing_dismissed, task.id] };
    await persist(next);
  };
  const saveTime = async () => {
    if (!(await persist(settings))) return;
    if (settings.briefing_enabled && isNativeMobile()) {
      try {
        const scheduled = await scheduleNativeReminder(settings);
        setMessage(
          scheduled
            ? "Reminder time updated."
            : "Reminder time saved, but Android could not schedule it.",
        );
      } catch {
        setMessage("Reminder time saved, but scheduling failed. Try again when online.");
      }
    }
  };
  const comingTasks = openTasks
    .filter(
      (task) =>
        task.due_at &&
        new Date(task.due_at) >= dayStart &&
        new Date(task.due_at) < addDays(dayStart, 7),
    )
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  const comingEvents = events
    .filter(
      (event) =>
        !event.completed &&
        event.date >= date &&
        event.date < format(addDays(dayStart, 7), "yyyy-MM-dd"),
    )
    .sort((a, b) =>
      `${a.date}T${a.startTime ?? "00:00"}`.localeCompare(`${b.date}T${b.startTime ?? "00:00"}`),
    );

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Personal Command Center</p>
          <h1 className="text-3xl font-semibold">Daily Briefing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A grounded view of your tasks, calendar, and study progress.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <CalendarDays className="h-4 w-4" />
          <span className="sr-only">Briefing date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3"
          />
        </label>
      </header>
      {message && (
        <p role="status" className="rounded-lg border border-border bg-card/70 p-3 text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <section className="grid gap-3 sm:grid-cols-3">
        <GlassCard className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Open tasks</p>
          <p className="mt-1 text-2xl font-semibold">{openTasks.length}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Overdue</p>
          <p className="mt-1 text-2xl font-semibold text-amber-400">{overdue.length}</p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Study today</p>
          <p className="mt-1 text-2xl font-semibold">
            {studyMinutes === null ? "—" : `${studyMinutes} min`}
          </p>
        </GlassCard>
      </section>
      <GlassCard className="p-5">
        <SectionTitle hint={format(selected, "EEEE, MMMM d")}>YOUR SUMMARY</SectionTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          {overdue.length
            ? `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"} need attention. `
            : "No overdue tasks in your task list. "}
          {dayTasks.length
            ? `${dayTasks.length} task${dayTasks.length === 1 ? " is" : "s are"} due today. `
            : "No tasks are due on this date. "}
          {dayEvents.length
            ? `${dayEvents.length} calendar event${dayEvents.length === 1 ? " is" : "s are"} scheduled.`
            : "No calendar events are scheduled on this date."}
          {accomplished.length
            ? ` You completed ${accomplished.length} task${accomplished.length === 1 ? "" : "s"} yesterday.`
            : ""}
        </p>
        {openTasks.length === 0 && dayEvents.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            There is not enough activity for a fuller briefing yet. Add tasks in{" "}
            <Link to="/tasks" className="text-primary underline">
              Tasks
            </Link>{" "}
            or events in{" "}
            <Link to="/calendar" className="text-primary underline">
              Calendar
            </Link>
            .
          </p>
        )}
      </GlassCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <SectionTitle hint={`${overdue.length} overdue`}>TASKS & REMINDERS</SectionTitle>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading tasks…</p>
          ) : openTasks.filter((task) => overdue.includes(task) || dayTasks.includes(task))
              .length ? (
            <ul className="space-y-2">
              {[...overdue, ...dayTasks.filter((task) => !overdue.includes(task))].map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-2 rounded-xl border border-border/70 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{task.title}</p>
                    <p
                      className={`text-xs ${overdue.includes(task) ? "text-amber-400" : "text-muted-foreground"}`}
                    >
                      {overdue.includes(task) ? "Overdue" : "Due today"} · {task.priority} priority
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Postpone ${task.title} one day`}
                    onClick={() => void postpone(task)}
                  >
                    <Clock3 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Complete ${task.title}`}
                    onClick={() => void completeTask(task)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing due on this date.{" "}
              <Link to="/tasks" className="text-primary underline">
                Open tasks
              </Link>
            </p>
          )}
        </GlassCard>
        <GlassCard className="p-5">
          <SectionTitle hint={`${dayEvents.length} scheduled`}>CALENDAR</SectionTitle>
          {dayEvents.length ? (
            <ul className="space-y-2">
              {dayEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-3 rounded-xl border border-border/70 p-3"
                >
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{event.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {event.startTime ?? "All day"} · {event.category}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Complete ${event.title}`}
                    onClick={() => toggleComplete(event.id)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No events on this date.{" "}
              <Link to="/calendar" className="text-primary underline">
                Open calendar
              </Link>
            </p>
          )}
        </GlassCard>
      </div>
      <GlassCard className="p-5">
        <SectionTitle hint="Recommendations use due dates, priority, and your focus preference">
          SUGGESTED NEXT ACTIONS
        </SectionTitle>
        {suggestions.length ? (
          <ul className="space-y-2">
            {suggestions.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 p-3"
              >
                <Sparkles className="h-4 w-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{task.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {task.due_at && new Date(task.due_at) < startOfDay(selected)
                      ? "Recommended because it is overdue."
                      : task.due_at && isSameDay(new Date(task.due_at), selected)
                        ? "Recommended because it is due today."
                        : task.priority === "high"
                          ? "Recommended because you marked it high priority."
                          : settings.briefing_focus &&
                              task.title
                                .toLowerCase()
                                .includes(settings.briefing_focus.toLowerCase())
                            ? "Matches your stated focus."
                            : "Suggested from your open tasks and priority."}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void completeTask(task)}>
                  Complete
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Dismiss suggestion for ${task.title}`}
                  onClick={() => void dismiss(task)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No suggested actions. Add a task or clear dismissed suggestions below.
          </p>
        )}
      </GlassCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <SectionTitle hint="Next 7 days">COMING UP</SectionTitle>
          {comingTasks.length || comingEvents.length ? (
            <ul className="space-y-2">
              {[
                ...comingTasks.map((task) => ({
                  id: task.id,
                  title: task.title,
                  when: task.due_at!,
                  kind: "Task",
                })),
                ...comingEvents.map((event) => ({
                  id: event.id,
                  title: event.title,
                  when: event.date,
                  kind: "Event",
                })),
              ]
                .sort((a, b) => a.when.localeCompare(b.when))
                .slice(0, 8)
                .map((item) => (
                  <li
                    key={`${item.kind}-${item.id}`}
                    className="flex justify-between gap-3 rounded-lg border border-border/70 p-3 text-sm"
                  >
                    <span className="truncate">
                      {item.title}
                      <span className="ml-2 text-xs text-muted-foreground">{item.kind}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {format(parseISO(item.when), "EEE, MMM d")}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing scheduled in the next seven days.
            </p>
          )}
        </GlassCard>
        <GlassCard className="p-5">
          <SectionTitle hint="Authorized project activity">RECENT WORKSPACE ACTIVITY</SectionTitle>
          {activity.length ? (
            <ul className="space-y-2">
              {activity.map((item) => (
                <li
                  key={item.id}
                  className="flex justify-between gap-3 rounded-lg border border-border/70 p-3 text-sm"
                >
                  <span>
                    {item.action} · {item.entity_type}
                  </span>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {format(parseISO(item.created_at), "MMM d, h:mm a")}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No recent project activity is available.
            </p>
          )}
        </GlassCard>
      </div>
      <GlassCard className="p-5">
        <SectionTitle>PERSONALIZE & REMIND</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>Your focus (optional)</span>
            <input
              value={settings.briefing_focus}
              onChange={(e) => setSettings({ ...settings, briefing_focus: e.target.value })}
              onBlur={() => settingsReady && void persist(settings)}
              placeholder="e.g. exam preparation"
              className="h-10 w-full rounded-lg border border-border bg-background px-3"
            />
          </label>
          <div className="space-y-1 text-sm">
            <label className="block">Daily reminder time</label>
            <div className="flex gap-2">
              <input
                type="time"
                value={settings.briefing_time.slice(0, 5)}
                onChange={(e) =>
                  setSettings({ ...settings, briefing_time: e.target.value + ":00" })
                }
                className="h-10 rounded-lg border border-border bg-background px-3"
              />
              <Button
                variant="outline"
                disabled={saving || !settingsReady}
                onClick={() => void saveTime()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            <p className="text-sm font-medium">Daily briefing reminder</p>
            <p className="text-xs text-muted-foreground">
              {isNativeMobile()
                ? `Android device reminder · ${settings.briefing_timezone}`
                : `Android app required for scheduled reminders · ${settings.briefing_timezone}`}
            </p>
          </div>
          <Button
            variant={settings.briefing_enabled ? "default" : "outline"}
            disabled={!settingsReady || saving || !isNativeMobile()}
            onClick={() => void toggleReminder(!settings.briefing_enabled)}
          >
            <Bell className="mr-2 h-4 w-4" />
            {settings.briefing_enabled ? "Enabled" : "Enable reminder"}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void persist({ ...settings, briefing_dismissed: [] })}
          >
            Restore dismissed suggestions
          </Button>
          <Link
            to="/calendar"
            className="inline-flex items-center gap-1 text-sm text-primary underline"
          >
            Calendar <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </GlassCard>
    </main>
  );
}
