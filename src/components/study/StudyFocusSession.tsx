import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Timer, X } from "lucide-react";
import {
  advanceFocusSession,
  clearActiveFocusSession,
  getElapsedMilliseconds,
  getPhaseDurationMilliseconds,
  readActiveFocusSession,
  retryPendingFocusSessions,
  saveFocusSession,
  writeActiveFocusSession,
  type ActiveFocusSession,
  type FocusMode,
  type FocusSessionStatus,
} from "@/lib/learning/focus-sessions";
import { isNativeMobile, mobileHaptics } from "@/lib/mobile-native";

const TIMER_EVENT = "lord:open-focus-session";

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getFocusedMilliseconds(session: ActiveFocusSession, now: number): number {
  return session.focusedMs + (session.phase === "focus" ? getElapsedMilliseconds(session, now) : 0);
}

export function StudyFocusSession({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<ActiveFocusSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const [mode, setMode] = useState<FocusMode>("pomodoro");
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [shortBreakMinutes, setShortBreakMinutes] = useState(5);
  const [longBreakMinutes, setLongBreakMinutes] = useState(15);
  const [longBreakInterval, setLongBreakInterval] = useState(4);
  const [subject, setSubject] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const completingRef = useRef(false);

  const persist = useCallback(
    (next: ActiveFocusSession | null) => {
      if (next) writeActiveFocusSession(userId, next);
      else clearActiveFocusSession(userId);
      setSession(next);
    },
    [userId],
  );

  const finish = useCallback(
    async (active: ActiveFocusSession, status: FocusSessionStatus, at: number) => {
      if (completingRef.current) return;
      completingRef.current = true;
      setSaving(true);
      setError(null);
      const durationSeconds = Math.floor(getFocusedMilliseconds(active, at) / 1000);
      const record = {
        id: active.id,
        mode: active.mode,
        status,
        subject: active.subject.trim() || null,
        label: active.label.trim() || null,
        duration_seconds: durationSeconds,
        planned_seconds: active.mode === "countdown" ? active.focusMinutes * 60 : null,
        started_at: active.startedAt,
        completed_at: new Date(at).toISOString(),
      } as const;
      try {
        const synced = await saveFocusSession(userId, record);
        clearActiveFocusSession(userId);
        setSession(null);
        if (!synced) {
          setError(
            "Session saved on this device and queued to sync when your connection is available.",
          );
        }
        if (status === "completed" && isNativeMobile()) void mobileHaptics.success();
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save this session. It remains queued to retry.",
        );
      } finally {
        completingRef.current = false;
        setSaving(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    try {
      setSession(readActiveFocusSession(userId));
      setNow(Date.now());
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : "Could not restore the saved focus session.",
      );
    }
    void retryPendingFocusSessions(userId).catch((retryError: unknown) => {
      setError(
        retryError instanceof Error ? retryError.message : "A saved session could not be synced.",
      );
    });
    const onOnline = () => {
      void retryPendingFocusSessions(userId).catch((retryError: unknown) => {
        setError(
          retryError instanceof Error ? retryError.message : "A saved session could not be synced.",
        );
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [userId]);

  useEffect(() => {
    const syncActiveSession = (event: StorageEvent) => {
      if (event.key !== `lord-study-focus-active:${userId}`) return;
      try {
        setSession(readActiveFocusSession(userId));
      } catch (restoreError) {
        setError(
          restoreError instanceof Error
            ? restoreError.message
            : "Could not sync the active focus timer from another tab.",
        );
      }
    };
    window.addEventListener("storage", syncActiveSession);
    return () => window.removeEventListener("storage", syncActiveSession);
  }, [userId]);

  useEffect(() => {
    const openTimer = (event: Event) => {
      const detail = (
        event as CustomEvent<{ subject?: unknown; label?: unknown; minutes?: unknown }>
      ).detail;
      if (typeof detail?.subject === "string") setSubject(detail.subject.slice(0, 100));
      if (typeof detail?.label === "string") setLabel(detail.label.slice(0, 160));
      if (typeof detail?.minutes === "number" && Number.isFinite(detail.minutes)) {
        setFocusMinutes(Math.max(1, Math.min(180, Math.round(detail.minutes))));
        setMode("countdown");
      }
      setOpen(true);
    };
    window.addEventListener(TIMER_EVENT, openTimer);
    return () => window.removeEventListener(TIMER_EVENT, openTimer);
  }, []);

  useEffect(() => {
    if (session?.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.status]);

  useEffect(() => {
    if (!session || session.status !== "running") return;
    const next = advanceFocusSession(session, now);
    if (next.completed) {
      void finish(next.session, "completed", now);
      return;
    }
    if (
      next.session.elapsedMs !== session.elapsedMs ||
      next.session.phase !== session.phase ||
      next.session.focusedMs !== session.focusedMs
    ) {
      try {
        persist(next.session);
      } catch (persistError) {
        setError(
          persistError instanceof Error
            ? persistError.message
            : "Could not persist the active timer state.",
        );
      }
    }
  }, [finish, now, persist, session]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      requestAnimationFrame(() => dialogRef.current?.focus());
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  const currentElapsed = session ? getElapsedMilliseconds(session, now) : 0;
  const phaseDuration = session ? getPhaseDurationMilliseconds(session) : null;
  const remaining =
    phaseDuration === null ? currentElapsed : Math.max(0, phaseDuration - currentElapsed);
  const focusedSeconds = session ? Math.floor(getFocusedMilliseconds(session, now) / 1000) : 0;
  const timerLabel = useMemo(() => formatTime(remaining), [remaining]);
  const phaseName =
    session?.phase === "long_break"
      ? "Long break"
      : session?.phase === "short_break"
        ? "Short break"
        : "Focus";

  const start = () => {
    const begin = () => {
      const existing = readActiveFocusSession(userId);
      if (existing) {
        setSession(existing);
        setError("An active focus timer already exists for this account.");
        return;
      }
      const timestamp = Date.now();
      const next: ActiveFocusSession = {
        id: makeId(),
        mode,
        phase: "focus",
        status: "running",
        focusMinutes,
        shortBreakMinutes,
        longBreakMinutes,
        longBreakInterval,
        elapsedMs: 0,
        focusedMs: 0,
        cycle: 0,
        subject: subject.trim(),
        label: label.trim(),
        startedAt: new Date(timestamp).toISOString(),
        runningSince: timestamp,
      };
      writeActiveFocusSession(userId, next);
      setSession(next);
      setNow(timestamp);
      setError(null);
    };
    try {
      if (typeof navigator !== "undefined" && navigator.locks) {
        void navigator.locks
          .request(`lord-study-focus:${userId}`, begin)
          .catch((persistError: unknown) => {
            setError(
              persistError instanceof Error
                ? persistError.message
                : "Could not start the focus timer.",
            );
          });
      } else {
        begin();
      }
    } catch (persistError) {
      setError(
        persistError instanceof Error ? persistError.message : "Could not start the focus timer.",
      );
    }
  };

  const pause = () => {
    if (!session) return;
    const timestamp = Date.now();
    const elapsedMs = getElapsedMilliseconds(session, timestamp);
    const next = { ...session, status: "paused" as const, elapsedMs, runningSince: null };
    try {
      persist(next);
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : "Could not pause the timer.");
    }
  };

  const resume = () => {
    if (!session) return;
    const timestamp = Date.now();
    try {
      persist({ ...session, status: "running", runningSince: timestamp });
      setNow(timestamp);
    } catch (persistError) {
      setError(
        persistError instanceof Error ? persistError.message : "Could not resume the timer.",
      );
    }
  };

  const discard = () => {
    if (
      !session ||
      !window.confirm("Discard this focus session? Its elapsed time will be saved as interrupted.")
    ) {
      return;
    }
    void finish(session, "interrupted", Date.now());
  };

  const endSession = () => {
    if (!session || !window.confirm("End and save this focus session now?")) return;
    const status: FocusSessionStatus =
      session.mode === "countdown" &&
      getFocusedMilliseconds(session, Date.now()) < session.focusMinutes * 60_000
        ? "interrupted"
        : "completed";
    void finish(session, status, Date.now());
  };

  const skipBreak = () => {
    if (!session || session.phase === "focus") return;
    const timestamp = Date.now();
    try {
      persist({
        ...session,
        phase: "focus",
        elapsedMs: 0,
        status: "running",
        runningSince: timestamp,
      });
      setNow(timestamp);
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : "Could not skip the break.");
    }
  };

  const setModeAndDuration = (nextMode: FocusMode) => {
    setMode(nextMode);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-sm text-foreground hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={session ? "Open active focus timer" : "Start a focus session"}
      >
        <Timer className="h-4 w-4 text-primary" />
        {session ? `${phaseName} ${timerLabel}` : "Start studying"}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-title"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key === "Tab") {
                const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
                  "button:not([disabled]), input:not([disabled]), select:not([disabled])",
                );
                if (!controls?.length) return;
                const first = controls[0];
                const last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 id="focus-title" className="text-lg font-semibold">
                  LORD Study Focus
                </h2>
                <p className="text-sm text-muted-foreground">
                  Timer state is saved on this device and restored after navigation or reload.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted"
                aria-label="Close focus timer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!session ? (
              <>
                <div className="mt-5 grid grid-cols-3 gap-2" role="group" aria-label="Timer mode">
                  {(["countdown", "pomodoro", "stopwatch"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={mode === option}
                      onClick={() => setModeAndDuration(option)}
                      className={`min-h-10 rounded-lg border px-2 text-sm capitalize ${mode === option ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>

                {mode !== "stopwatch" && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <label className="text-sm">
                      {mode === "pomodoro" ? "Focus minutes" : "Duration in minutes"}
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={focusMinutes}
                        onChange={(event) => setFocusMinutes(Number(event.target.value))}
                        className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3"
                      />
                    </label>
                    {mode === "pomodoro" && (
                      <>
                        <label className="text-sm">
                          Short break
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={shortBreakMinutes}
                            onChange={(event) => setShortBreakMinutes(Number(event.target.value))}
                            className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3"
                          />
                        </label>
                        <label className="text-sm">
                          Long break
                          <input
                            type="number"
                            min={1}
                            max={90}
                            value={longBreakMinutes}
                            onChange={(event) => setLongBreakMinutes(Number(event.target.value))}
                            className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3"
                          />
                        </label>
                        <label className="text-sm">
                          Long break after focus blocks
                          <input
                            type="number"
                            min={2}
                            max={8}
                            value={longBreakInterval}
                            onChange={(event) => setLongBreakInterval(Number(event.target.value))}
                            className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3"
                          />
                        </label>
                      </>
                    )}
                  </div>
                )}

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    Subject (optional)
                    <input
                      value={subject}
                      maxLength={100}
                      onChange={(event) => setSubject(event.target.value)}
                      placeholder="e.g. Biology"
                      className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3"
                    />
                  </label>
                  <label className="text-sm">
                    Session label (optional)
                    <input
                      value={label}
                      maxLength={160}
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder="e.g. Chapter 4 revision"
                      className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  disabled={
                    saving ||
                    focusMinutes < 1 ||
                    !Number.isInteger(focusMinutes) ||
                    focusMinutes > 180 ||
                    shortBreakMinutes < 1 ||
                    !Number.isInteger(shortBreakMinutes) ||
                    shortBreakMinutes > 60 ||
                    longBreakMinutes < 1 ||
                    !Number.isInteger(longBreakMinutes) ||
                    longBreakMinutes > 90 ||
                    longBreakInterval < 2 ||
                    !Number.isInteger(longBreakInterval) ||
                    longBreakInterval > 8
                  }
                  onClick={start}
                  className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" /> Start focus session
                </button>
              </>
            ) : (
              <>
                <div className="mt-7 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background px-4 py-7 text-center">
                  <p className="text-sm font-medium text-primary">
                    {phaseName}
                    {session.mode === "pomodoro" && session.phase === "focus"
                      ? ` · Block ${session.cycle + 1}`
                      : ""}
                  </p>
                  <div
                    role="timer"
                    aria-live="off"
                    aria-label={
                      phaseDuration === null
                        ? `${formatTime(currentElapsed)} elapsed`
                        : `${formatTime(remaining)} remaining`
                    }
                    className="mt-2 font-mono text-6xl font-semibold tabular-nums tracking-tight sm:text-7xl"
                  >
                    {timerLabel}
                  </div>
                  <p aria-live="polite" className="mt-3 min-h-5 text-sm text-muted-foreground">
                    {session.status === "running"
                      ? "In progress · elapsed time uses timestamps, not interval counts."
                      : "Paused · resume when you are ready."}
                  </p>
                  {(session.subject || session.label) && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {[session.subject, session.label].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {session.status === "running" ? (
                    <button
                      type="button"
                      onClick={pause}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
                    >
                      <Pause className="h-4 w-4" /> Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={resume}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
                    >
                      <Play className="h-4 w-4" /> Resume
                    </button>
                  )}
                  {session.mode === "pomodoro" && session.phase !== "focus" && (
                    <button
                      type="button"
                      onClick={skipBreak}
                      className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-muted"
                    >
                      Skip break
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={endSession}
                    disabled={saving}
                    className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    End session
                  </button>
                  <button
                    type="button"
                    onClick={discard}
                    disabled={saving}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-destructive/40 px-4 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" /> Discard
                  </button>
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  {Math.floor(focusedSeconds / 60)} focused minutes recorded so far. Break time is
                  excluded.
                </p>
              </>
            )}

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
              >
                {error}
                <button
                  type="button"
                  onClick={() => {
                    setSaving(true);
                    void retryPendingFocusSessions(userId)
                      .then(() => setError(null))
                      .catch((retryError: unknown) => {
                        setError(
                          retryError instanceof Error
                            ? retryError.message
                            : "Could not sync the saved session.",
                        );
                      })
                      .finally(() => setSaving(false));
                  }}
                  disabled={saving}
                  className="ml-2 underline underline-offset-2 disabled:opacity-50"
                >
                  Retry sync
                </button>
              </div>
            )}
            {!session && saving && (
              <p role="status" className="mt-3 text-center text-sm text-muted-foreground">
                Saving study session…
              </p>
            )}
            <div className="sr-only" aria-live="polite">
              {session?.status === "running" ? `${phaseName} timer is running.` : ""}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
