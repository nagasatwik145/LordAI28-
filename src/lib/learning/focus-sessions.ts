import { getApiBaseUrl } from "@/lib/api-config";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

export type FocusMode = "countdown" | "pomodoro" | "stopwatch";
export type FocusSessionStatus = "completed" | "interrupted";

export interface FocusSessionRecord {
  id: string;
  mode: FocusMode;
  status: FocusSessionStatus;
  subject: string | null;
  label: string | null;
  duration_seconds: number;
  planned_seconds: number | null;
  started_at: string;
  completed_at: string;
}

export type FocusSessionSubmission = FocusSessionRecord;

export interface ActiveFocusSession {
  id: string;
  mode: FocusMode;
  phase: "focus" | "short_break" | "long_break";
  status: "running" | "paused";
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  elapsedMs: number;
  focusedMs: number;
  cycle: number;
  subject: string;
  label: string;
  startedAt: string;
  runningSince: number | null;
}

const ACTIVE_KEY_PREFIX = "lord-study-focus-active:";
const PENDING_KEY_PREFIX = "lord-study-focus-pending:";

function userKey(prefix: string, userId: string): string {
  return `${prefix}${userId}`;
}

export function readActiveFocusSession(userId: string): ActiveFocusSession | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(userKey(ACTIVE_KEY_PREFIX, userId));
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  if (!isActiveFocusSession(parsed)) {
    throw new Error("Saved focus session data is invalid. It was not changed.");
  }
  return parsed;
}

export function writeActiveFocusSession(userId: string, session: ActiveFocusSession): void {
  if (typeof localStorage === "undefined") {
    throw new Error("Focus session persistence is not available in this browser.");
  }
  localStorage.setItem(userKey(ACTIVE_KEY_PREFIX, userId), JSON.stringify(session));
}

export function clearActiveFocusSession(userId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(userKey(ACTIVE_KEY_PREFIX, userId));
}

export function getElapsedMilliseconds(session: ActiveFocusSession, now: number): number {
  return Math.max(
    0,
    session.elapsedMs +
      (session.status === "running" && session.runningSince !== null
        ? now - session.runningSince
        : 0),
  );
}

export function getPhaseDurationMilliseconds(session: ActiveFocusSession): number | null {
  switch (session.phase) {
    case "focus":
      return session.mode === "stopwatch" ? null : session.focusMinutes * 60_000;
    case "short_break":
      return session.shortBreakMinutes * 60_000;
    case "long_break":
      return session.longBreakMinutes * 60_000;
  }
}

export function advanceFocusSession(
  session: ActiveFocusSession,
  now: number,
): { session: ActiveFocusSession; completed: boolean } {
  if (session.status !== "running") return { session, completed: false };
  let current = { ...session };
  let elapsed = getElapsedMilliseconds(current, now);

  while (true) {
    const phaseDuration = getPhaseDurationMilliseconds(current);
    if (phaseDuration === null || elapsed < phaseDuration) {
      return {
        session: { ...current, elapsedMs: elapsed, runningSince: now },
        completed: false,
      };
    }

    const overflow = elapsed - phaseDuration;
    if (current.mode !== "pomodoro") {
      return {
        session: {
          ...current,
          elapsedMs: phaseDuration,
          focusedMs: current.focusedMs + (current.phase === "focus" ? phaseDuration : 0),
          status: "paused",
          runningSince: null,
        },
        completed: true,
      };
    }

    if (current.phase === "focus") {
      const cycle = current.cycle + 1;
      current = {
        ...current,
        cycle,
        focusedMs: current.focusedMs + phaseDuration,
        phase: cycle % current.longBreakInterval === 0 ? "long_break" : "short_break",
      };
    } else {
      current = { ...current, phase: "focus" };
    }
    current.elapsedMs = 0;
    current.runningSince = now;
    elapsed = overflow;
  }
}

export async function listFocusSessions(): Promise<FocusSessionRecord[]> {
  const response = await authenticatedFetch(`${getApiBaseUrl()}/api/learning/focus-sessions`);
  if (!response.ok) throw new Error(`Could not load focus sessions (${response.status}).`);
  const result: unknown = await response.json();
  const sessions = result && typeof result === "object" ? Reflect.get(result, "sessions") : null;
  if (!Array.isArray(sessions) || !sessions.every(isFocusSessionRecord)) {
    throw new Error("Focus sessions response was invalid.");
  }
  return sessions;
}

function pendingSessions(userId: string): FocusSessionSubmission[] {
  if (typeof localStorage === "undefined") return [];
  const value = localStorage.getItem(userKey(PENDING_KEY_PREFIX, userId));
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(isFocusSessionSubmission)) {
    throw new Error("Pending focus session data is invalid. It was not changed.");
  }
  return parsed;
}

function savePendingSessions(userId: string, records: FocusSessionSubmission[]): void {
  if (typeof localStorage === "undefined") {
    throw new Error("Focus session persistence is not available in this browser.");
  }
  localStorage.setItem(userKey(PENDING_KEY_PREFIX, userId), JSON.stringify(records));
}

export async function saveFocusSession(
  userId: string,
  session: FocusSessionSubmission,
): Promise<boolean> {
  const queued = pendingSessions(userId);
  if (!queued.some((record) => record.id === session.id)) {
    savePendingSessions(userId, [session, ...queued]);
  }
  let response: Response;
  try {
    response = await authenticatedFetch(`${getApiBaseUrl()}/api/learning/focus-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
  } catch {
    return false;
  }
  if (!response.ok) return false;
  savePendingSessions(
    userId,
    pendingSessions(userId).filter((record) => record.id !== session.id),
  );
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("lord:focus-session-complete", { detail: { userId } }));
  }
  return true;
}

export async function retryPendingFocusSessions(userId: string): Promise<void> {
  for (const session of pendingSessions(userId)) {
    if (!(await saveFocusSession(userId, session))) {
      throw new Error("A completed focus session is queued and could not sync yet.");
    }
  }
}

export function summarizeFocusSessions(
  records: FocusSessionRecord[],
  now = new Date(),
): {
  todaySeconds: number;
  weekSeconds: number;
  completedSessions: number;
  averageSessionSeconds: number;
  streakDays: number;
  subjectSeconds: Array<{ subject: string; seconds: number }>;
  dailySeconds: Array<{ date: string; seconds: number }>;
} {
  const completed = records.filter(
    (record) => record.status === "completed" && record.duration_seconds > 0,
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const dayKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const subjectSeconds = new Map<string, number>();
  const dailySeconds = new Map<string, number>();
  let todaySeconds = 0;
  let weekSeconds = 0;

  for (const record of completed) {
    const completedAt = new Date(record.completed_at);
    if (!Number.isFinite(completedAt.getTime())) continue;
    const seconds = Math.max(0, record.duration_seconds);
    const date = dayKey(completedAt);
    dailySeconds.set(date, (dailySeconds.get(date) ?? 0) + seconds);
    const day = new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
    if (day.getTime() === today.getTime()) todaySeconds += seconds;
    if (day >= weekStart && day <= today) weekSeconds += seconds;
    if (record.subject?.trim()) {
      const subject = record.subject.trim();
      subjectSeconds.set(subject, (subjectSeconds.get(subject) ?? 0) + seconds);
    }
  }

  const activeDays = new Set(dailySeconds.keys());
  const cursor = new Date(today);
  if (!activeDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streakDays = 0;
  while (activeDays.has(dayKey(cursor))) {
    streakDays++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    todaySeconds,
    weekSeconds,
    completedSessions: completed.length,
    averageSessionSeconds:
      completed.length > 0
        ? Math.round(
            completed.reduce((sum, record) => sum + record.duration_seconds, 0) / completed.length,
          )
        : 0,
    streakDays,
    subjectSeconds: [...subjectSeconds.entries()]
      .map(([subject, seconds]) => ({ subject, seconds }))
      .sort((left, right) => right.seconds - left.seconds),
    dailySeconds: [...dailySeconds.entries()]
      .map(([date, seconds]) => ({ date, seconds }))
      .sort((left, right) => left.date.localeCompare(right.date)),
  };
}

function isActiveFocusSession(value: unknown): value is ActiveFocusSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<ActiveFocusSession>;
  return (
    typeof session.id === "string" &&
    (session.mode === "countdown" || session.mode === "pomodoro" || session.mode === "stopwatch") &&
    (session.phase === "focus" ||
      session.phase === "short_break" ||
      session.phase === "long_break") &&
    (session.status === "running" || session.status === "paused") &&
    Number.isInteger(session.focusMinutes) &&
    Number.isInteger(session.shortBreakMinutes) &&
    Number.isInteger(session.longBreakMinutes) &&
    Number.isInteger(session.longBreakInterval) &&
    typeof session.focusMinutes === "number" &&
    session.focusMinutes >= 1 &&
    session.focusMinutes <= 180 &&
    typeof session.shortBreakMinutes === "number" &&
    session.shortBreakMinutes >= 1 &&
    session.shortBreakMinutes <= 60 &&
    typeof session.longBreakMinutes === "number" &&
    session.longBreakMinutes >= 1 &&
    session.longBreakMinutes <= 90 &&
    typeof session.longBreakInterval === "number" &&
    session.longBreakInterval >= 2 &&
    session.longBreakInterval <= 8 &&
    typeof session.elapsedMs === "number" &&
    Number.isFinite(session.elapsedMs) &&
    typeof session.focusedMs === "number" &&
    Number.isFinite(session.focusedMs) &&
    Number.isInteger(session.cycle) &&
    typeof session.subject === "string" &&
    typeof session.label === "string" &&
    typeof session.startedAt === "string" &&
    (session.runningSince === null || typeof session.runningSince === "number")
  );
}

function isFocusSessionSubmission(value: unknown): value is FocusSessionSubmission {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<FocusSessionSubmission>;
  return (
    typeof record.id === "string" &&
    (record.mode === "countdown" || record.mode === "pomodoro" || record.mode === "stopwatch") &&
    (record.status === "completed" || record.status === "interrupted") &&
    (typeof record.subject === "string" || record.subject === null) &&
    (typeof record.label === "string" || record.label === null) &&
    Number.isInteger(record.duration_seconds) &&
    (record.planned_seconds === null || Number.isInteger(record.planned_seconds)) &&
    typeof record.started_at === "string" &&
    typeof record.completed_at === "string"
  );
}

function isFocusSessionRecord(value: unknown): value is FocusSessionRecord {
  return (
    isFocusSessionSubmission(value) &&
    Number.isInteger(value.duration_seconds) &&
    (value.planned_seconds === null || Number.isInteger(value.planned_seconds))
  );
}
