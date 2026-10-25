import { describe, expect, it } from "vitest";
import {
  advanceFocusSession,
  getElapsedMilliseconds,
  getPhaseDurationMilliseconds,
  summarizeFocusSessions,
  type ActiveFocusSession,
  type FocusSessionRecord,
} from "./focus-sessions";

function activeSession(overrides: Partial<ActiveFocusSession> = {}): ActiveFocusSession {
  return {
    id: "session-1",
    mode: "countdown",
    phase: "focus",
    status: "running",
    focusMinutes: 1,
    shortBreakMinutes: 1,
    longBreakMinutes: 2,
    longBreakInterval: 2,
    elapsedMs: 0,
    focusedMs: 0,
    cycle: 0,
    subject: "",
    label: "",
    startedAt: new Date(0).toISOString(),
    runningSince: 0,
    ...overrides,
  };
}

function record(
  id: string,
  completedAt: Date,
  durationSeconds: number,
  overrides: Partial<FocusSessionRecord> = {},
): FocusSessionRecord {
  return {
    id,
    mode: "countdown",
    status: "completed",
    subject: "Biology",
    label: null,
    duration_seconds: durationSeconds,
    planned_seconds: 1500,
    started_at: new Date(completedAt.getTime() - durationSeconds * 1000).toISOString(),
    completed_at: completedAt.toISOString(),
    ...overrides,
  };
}

describe("study focus timer", () => {
  it("reconciles elapsed time from timestamps after the timer interval is suspended", () => {
    const session = activeSession({ elapsedMs: 10_000, runningSince: 20_000 });
    expect(getElapsedMilliseconds(session, 45_000)).toBe(35_000);
  });

  it("does not add elapsed time while paused", () => {
    const session = activeSession({ status: "paused", elapsedMs: 30_000, runningSince: null });
    expect(getElapsedMilliseconds(session, 90_000)).toBe(30_000);
  });

  it("completes a countdown based on its elapsed timestamp", () => {
    const result = advanceFocusSession(activeSession(), 60_000);
    expect(result.completed).toBe(true);
    expect(result.session.status).toBe("paused");
    expect(result.session.focusedMs).toBe(60_000);
  });

  it("transitions between Pomodoro focus and break phases and excludes breaks", () => {
    const focus = activeSession({ mode: "pomodoro" });
    const firstBreak = advanceFocusSession(focus, 60_000);
    expect(firstBreak.session.phase).toBe("short_break");
    expect(firstBreak.session.focusedMs).toBe(60_000);

    const nextFocus = advanceFocusSession(firstBreak.session, 120_000);
    expect(nextFocus.session.phase).toBe("focus");
    expect(nextFocus.session.focusedMs).toBe(60_000);

    const longBreak = advanceFocusSession(nextFocus.session, 180_000);
    expect(longBreak.session.phase).toBe("long_break");
    expect(longBreak.session.focusedMs).toBe(120_000);
    expect(getPhaseDurationMilliseconds(longBreak.session)).toBe(120_000);
  });

  it("leaves stopwatch duration uncapped", () => {
    expect(getPhaseDurationMilliseconds(activeSession({ mode: "stopwatch" }))).toBeNull();
    expect(advanceFocusSession(activeSession({ mode: "stopwatch" }), 7_200_000).completed).toBe(
      false,
    );
  });
});

describe("summarizeFocusSessions", () => {
  it("counts completed focused time by day and subject, excluding interrupted sessions", () => {
    const now = new Date(2026, 9, 25, 12);
    const records = [
      record("one", new Date(2026, 9, 25, 10), 1500),
      record("two", new Date(2026, 9, 24, 10), 900, { subject: "Math" }),
      record("interrupted", new Date(2026, 9, 25, 11), 600, { status: "interrupted" }),
    ];
    expect(summarizeFocusSessions(records, now)).toEqual({
      todaySeconds: 1500,
      weekSeconds: 2400,
      completedSessions: 2,
      averageSessionSeconds: 1200,
      streakDays: 2,
      subjectSeconds: [
        { subject: "Biology", seconds: 1500 },
        { subject: "Math", seconds: 900 },
      ],
      dailySeconds: [
        { date: "2026-10-24", seconds: 900 },
        { date: "2026-10-25", seconds: 1500 },
      ],
    });
  });

  it("returns a zeroed summary for an empty study history", () => {
    expect(summarizeFocusSessions([], new Date(2026, 9, 25))).toMatchObject({
      todaySeconds: 0,
      weekSeconds: 0,
      completedSessions: 0,
      averageSessionSeconds: 0,
      streakDays: 0,
      subjectSeconds: [],
      dailySeconds: [],
    });
  });
});
