import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Circle,
  Eye,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Json } from "@/integrations/supabase/types";
import {
  type MissionAction,
  type MissionEvent,
  type MissionPlan,
  type MissionStatus,
} from "@/lib/autopilot/mission-engine";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { cn } from "@/lib/utils";

interface MissionView {
  id: string;
  objective: string;
  status: MissionStatus;
  plan: MissionPlan;
  events: MissionEvent[];
  result: Json | null;
  revision: number;
  executionLeaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MissionListResponse {
  missions: MissionView[];
  availableActions: MissionAction[];
}

async function missionRequest<T>(
  input: {
    action: string;
    missionId?: string;
    objective?: string;
    answers?: string;
    requestId?: string;
  } | null,
  missionId?: string,
): Promise<T> {
  const url = new URL("/api/missions", window.location.origin);
  if (missionId) url.searchParams.set("id", missionId);
  const response = await authenticatedFetch(url, {
    method: input ? "POST" : "GET",
    headers: input ? { "Content-Type": "application/json" } : undefined,
    body: input ? JSON.stringify(input) : undefined,
    credentials: "include",
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? (payload.error as { message?: string }).message
        : undefined;
    throw new Error(message || "Mission request failed.");
  }
  return payload as T;
}

function statusLabel(status: MissionStatus): string {
  return status.replaceAll("_", " ");
}

function isActive(status: MissionStatus): boolean {
  return [
    "planning",
    "planned",
    "running",
    "paused",
    "needs_approval",
    "needs_clarification",
  ].includes(status);
}

export function MissionWorkspace({ isPro }: { isPro: boolean }) {
  const [open, setOpen] = useState(false);
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [mission, setMission] = useState<MissionView | null>(null);
  const [availableActions, setAvailableActions] = useState<MissionAction[]>([]);
  const [objective, setObjective] = useState("");
  const [answers, setAnswers] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [executionPending, setExecutionPending] = useState(false);
  const [resultsVisible, setResultsVisible] = useState(false);
  const runLock = useRef(false);
  const planRequestId = useRef<string | null>(null);

  const acceptMission = useCallback((next: MissionView) => {
    setMission(next);
    setMissions((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    window.localStorage.setItem("lord-autopilot-selected-mission", next.id);
  }, []);

  const refreshMission = useCallback(
    async (id: string) => {
      const response = await missionRequest<{
        mission: MissionView;
        availableActions: MissionAction[];
      }>(null, id);
      acceptMission(response.mission);
      setAvailableActions(response.availableActions);
    },
    [acceptMission],
  );

  useEffect(() => {
    if (!open || !isPro) return;
    let active = true;
    setLoading(true);
    setNotice("");
    missionRequest<MissionListResponse>(null)
      .then((response) => {
        if (!active) return;
        setMissions(response.missions);
        setAvailableActions(response.availableActions);
        const savedId = window.localStorage.getItem("lord-autopilot-selected-mission");
        const selected =
          response.missions.find((item) => item.id === savedId) ?? response.missions[0];
        setMission(selected ?? null);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : "Could not load missions.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, isPro]);

  const activeMissionId = mission?.id;
  const activeMissionStatus = mission?.status;

  useEffect(() => {
    if (!open || !activeMissionId || (activeMissionStatus !== "running" && !executionPending)) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshMission(activeMissionId).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Could not refresh mission progress.");
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [open, activeMissionId, activeMissionStatus, executionPending, refreshMission]);

  const sendAction = async (action: string) => {
    if (!mission) return;
    setLoading(true);
    setNotice("");
    try {
      const response = await missionRequest<{ mission: MissionView }>({
        action,
        missionId: mission.id,
      });
      acceptMission(response.mission);
      setAnswers("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The mission action failed.");
    } finally {
      setLoading(false);
    }
  };

  const startMission = async () => {
    if (runLock.current || !mission) return;
    runLock.current = true;
    setExecutionPending(true);
    setNotice("");
    try {
      let current = mission;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const response = await missionRequest<{ mission: MissionView }>({
          action: "run",
          missionId: current.id,
        });
        current = response.mission;
        acceptMission(current);
        if (current.status !== "planned") break;
        const retryAt = current.plan.steps.find((step) => step.status === "retrying")?.retryAt;
        const retryDelay = retryAt ? Date.parse(retryAt) - Date.now() : 0;
        if (retryDelay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, Math.min(retryDelay, 30_000)));
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Mission execution failed.");
      if (mission) void refreshMission(mission.id).catch(() => undefined);
    } finally {
      runLock.current = false;
      setExecutionPending(false);
    }
  };

  const createPlan = async () => {
    setLoading(true);
    setNotice("");
    setResultsVisible(false);
    const requestId = planRequestId.current ?? crypto.randomUUID();
    planRequestId.current = requestId;
    try {
      const response = await missionRequest<{ mission: MissionView }>({
        action: "plan",
        objective,
        requestId,
      });
      acceptMission(response.mission);
      setObjective("");
      planRequestId.current = null;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Mission planning failed.");
    } finally {
      setLoading(false);
    }
  };

  const submitClarifications = async () => {
    if (!mission) return;
    setLoading(true);
    setNotice("");
    try {
      const response = await missionRequest<{ mission: MissionView }>({
        action: "clarify",
        missionId: mission.id,
        answers,
      });
      acceptMission(response.mission);
      setAnswers("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update the mission plan.");
    } finally {
      setLoading(false);
    }
  };

  const failedStep = mission?.plan.steps.find((step) => step.status === "failed");
  const mayRecoverRunning =
    mission?.status === "running" &&
    (!mission.executionLeaseUntil || Date.parse(mission.executionLeaseUntil) <= Date.now());
  const mayRetry =
    mission?.status === "failed" &&
    failedStep !== undefined &&
    failedStep.attempts < failedStep.retryPolicy.maxRetries + 1;

  return (
    <>
      <button
        type="button"
        aria-label={
          isPro ? "Open LORD Autopilot mission workspace" : "LORD Autopilot requires LORD Pro"
        }
        title={isPro ? "Mission Mode" : "Mission Mode · LORD Pro"}
        onClick={() => {
          if (!isPro) {
            window.location.assign("/upgrade");
            return;
          }
          setOpen(true);
        }}
        className={cn(
          "relative flex h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs transition focus-visible:ring-2 focus-visible:ring-cyan-400",
          isPro
            ? "border-cyan-300/30 bg-cyan-300/[0.08] text-cyan-100 hover:border-cyan-200/60 hover:bg-cyan-300/[0.14]"
            : "border-white/10 text-white/55 hover:text-white",
        )}
      >
        {isPro ? <Sparkles className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
        <span>Mission</span>
        {!isPro && <span className="text-[9px] text-amber-200">PRO</span>}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden border-cyan-300/20 bg-[#070c19] p-0 text-white shadow-[0_0_70px_rgba(0,200,255,0.12)] sm:max-h-[calc(100dvh-2rem)]">
          <DialogHeader className="relative shrink-0 overflow-hidden border-b border-white/10 px-4 py-4 text-left sm:px-6">
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute -right-8 -top-16 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl"
              animate={{ opacity: [0.45, 0.8, 0.45], scale: [0.9, 1.1, 0.9] }}
              transition={{ duration: 4, repeat: Infinity }}
            />
            <DialogTitle className="relative flex items-center gap-2 text-base tracking-wide">
              <Sparkles className="h-4 w-4 text-cyan-200" />
              LORD Autopilot
            </DialogTitle>
            <DialogDescription className="relative text-xs text-white/55">
              Plan and run bounded tasks with LORD&apos;s configured tools. External actions require
              approval.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="hidden min-h-0 flex-col border-r border-white/10 bg-white/[0.02] lg:flex">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <span className="text-xs font-medium uppercase tracking-wider text-white/55">
                  Missions
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setMission(null);
                    setResultsVisible(false);
                  }}
                  className="rounded p-1 text-cyan-200 hover:bg-white/10"
                  aria-label="Create a new mission"
                >
                  <Sparkles className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {missions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      acceptMission(item);
                      setResultsVisible(false);
                      setNotice("");
                    }}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left transition",
                      mission?.id === item.id
                        ? "border-cyan-300/25 bg-cyan-300/[0.08]"
                        : "border-transparent hover:bg-white/[0.05]",
                    )}
                  >
                    <span className="block truncate text-xs text-white/85">{item.plan.title}</span>
                    <span className="mt-1 block text-[10px] capitalize text-white/45">
                      {statusLabel(item.status)}
                    </span>
                  </button>
                ))}
                {!missions.length && !loading && (
                  <p className="px-3 py-5 text-center text-xs text-white/40">
                    No saved missions yet.
                  </p>
                )}
              </div>
              <p className="border-t border-white/10 px-3 py-3 text-[10px] leading-relaxed text-white/35">
                {availableActions.length
                  ? `Enabled tools: ${availableActions.join(", ")}`
                  : "Configure LORD's server-side model to enable mission planning."}
              </p>
            </aside>

            <main className="min-h-0 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
              {mission ? (
                <div className="mx-auto max-w-3xl space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-white">{mission.plan.title}</h2>
                        <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-2 py-0.5 text-[10px] capitalize text-cyan-100">
                          {statusLabel(mission.status)}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/55">
                        {mission.objective}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMission(null)}
                      className="rounded-full border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
                      aria-label="Back to new mission"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <section className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-white/75">Persisted progress</span>
                      <span className="text-cyan-100">
                        {mission.plan.steps.filter((step) => step.status === "completed").length} of{" "}
                        {mission.plan.steps.length} steps complete
                      </span>
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-white/55">
                      {mission.plan.summary}
                    </p>
                  </section>

                  {mission.status === "needs_approval" && (
                    <section className="rounded-xl border border-amber-200/20 bg-amber-200/[0.04] p-4">
                      <h3 className="text-sm font-medium text-amber-100">
                        Review the requested action
                      </h3>
                      <p className="mt-1 text-xs text-white/55">
                        Approval applies only to the exact action and arguments shown below. A
                        changed plan requires a new approval.
                      </p>
                      <ul className="mt-3 space-y-3">
                        {mission.plan.steps
                          .filter((step) => step.requiresApproval)
                          .map((step) => (
                            <li key={step.id} className="rounded-lg border border-white/10 p-3">
                              <p className="text-xs font-medium text-white">{step.description}</p>
                              <p className="mt-1 text-[10px] text-white/45">Tool: {step.action}</p>
                              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[10px] text-white/60">
                                {JSON.stringify(step.arguments, null, 2)}
                              </pre>
                            </li>
                          ))}
                      </ul>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void sendAction("approve")}
                        className="mt-3 rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
                      >
                        Approve reviewed action
                      </button>
                    </section>
                  )}

                  {mission.status === "needs_clarification" && (
                    <section className="rounded-xl border border-amber-200/20 bg-amber-200/[0.04] p-4">
                      <h3 className="text-sm font-medium text-amber-100">A detail is needed</h3>
                      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-white/70">
                        {mission.plan.questions.map((question, index) => (
                          <li key={`${index}-${question}`}>{question}</li>
                        ))}
                      </ul>
                      <label
                        className="mt-3 block text-xs text-white/55"
                        htmlFor="mission-clarifications"
                      >
                        Your answer
                      </label>
                      <textarea
                        id="mission-clarifications"
                        value={answers}
                        onChange={(event) => setAnswers(event.target.value)}
                        maxLength={2_000}
                        rows={3}
                        className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                        placeholder="Add the missing context…"
                      />
                      <button
                        type="button"
                        disabled={!answers.trim() || loading}
                        onClick={() => void submitClarifications()}
                        className="mt-3 rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
                      >
                        Update plan
                      </button>
                    </section>
                  )}

                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">
                      Current action and recent events
                    </h3>
                    <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                      <p className="text-xs text-white/75">
                        {mission.plan.steps.find((step) => step.status === "running")
                          ?.description ??
                          (mission.status === "running"
                            ? "Preparing the next eligible step."
                            : "No action is currently running.")}
                      </p>
                      <ol className="mt-3 space-y-2 border-l border-white/10 pl-3">
                        {mission.events
                          .slice(-8)
                          .reverse()
                          .map((event) => (
                            <li
                              key={event.id}
                              className="text-[10px] leading-relaxed text-white/50"
                            >
                              <time dateTime={event.timestamp}>
                                {new Date(event.timestamp).toLocaleString()}
                              </time>
                              <span className="ml-2 text-white/75">{event.message}</span>
                            </li>
                          ))}
                      </ol>
                    </div>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">
                      Plan and dependencies
                    </h3>
                    {mission.plan.steps.map((step, index) => (
                      <article
                        key={step.id}
                        className="rounded-xl border border-white/10 bg-white/[0.025] p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 text-cyan-200">
                            {step.status === "completed" ? (
                              <Check className="h-4 w-4" />
                            ) : step.status === "running" ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <Circle className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="text-sm font-medium text-white">
                                {index + 1}. {step.description}
                              </h4>
                              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] capitalize text-white/45">
                                {statusLabel(step.status as MissionStatus)}
                              </span>
                              {step.requiresApproval && (
                                <span className="rounded border border-amber-200/20 px-1.5 py-0.5 text-[10px] text-amber-100">
                                  Approval
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-white/45">
                              Expected: {step.expectedResult}
                            </p>
                            {step.dependencies.length > 0 && (
                              <p className="mt-2 text-[10px] text-white/35">
                                Depends on: {step.dependencies.join(", ")}
                              </p>
                            )}
                            {step.result?.toolName && (
                              <p className="mt-2 text-[10px] text-cyan-100/65">
                                Tool: {step.result.toolName}
                              </p>
                            )}
                            {step.result?.content && (
                              <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/20 p-3 font-sans text-xs leading-relaxed text-white/75">
                                {step.result.content}
                              </pre>
                            )}
                            {step.result?.error && (
                              <p className="mt-2 rounded-lg border border-red-300/15 bg-red-300/[0.04] p-3 text-xs text-red-100/80">
                                {step.result.error}
                              </p>
                            )}
                            {(step.startedAt || step.completedAt || step.retryAt) && (
                              <p className="mt-2 text-[10px] text-white/40">
                                {step.startedAt &&
                                  `Started ${new Date(step.startedAt).toLocaleString()}`}
                                {step.completedAt &&
                                  ` · Finished ${new Date(step.completedAt).toLocaleString()}`}
                                {step.retryAt &&
                                  ` · Retry available ${new Date(step.retryAt).toLocaleString()}`}
                              </p>
                            )}
                            {(() => {
                              const resultData = step.result?.data;
                              const gameId =
                                resultData &&
                                typeof resultData === "object" &&
                                "gameId" in resultData &&
                                typeof resultData.gameId === "string"
                                  ? resultData.gameId
                                  : null;

                              return gameId ? (
                                <a
                                  href={`/create-apka-jalwa?gameId=${encodeURIComponent(gameId)}`}
                                  className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200 underline underline-offset-2"
                                >
                                  Open generated game
                                </a>
                              ) : null;
                            })()}
                          </div>
                        </div>
                      </article>
                    ))}
                    {!mission.plan.steps.length && mission.status !== "planning" && (
                      <p className="rounded-lg border border-white/10 p-4 text-xs text-white/50">
                        No executable steps are in this plan.
                      </p>
                    )}
                  </section>

                  {resultsVisible && mission.result && (
                    <section
                      aria-live="polite"
                      className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] p-4"
                    >
                      <h3 className="text-sm font-medium text-cyan-100">Mission results</h3>
                      <p className="mt-2 text-xs leading-relaxed text-white/70">
                        {mission.status === "completed"
                          ? mission.plan.summary
                          : "The mission ended with unresolved work. Review failed and skipped steps above."}
                      </p>
                      <p className="mt-2 text-[10px] text-white/40">
                        {mission.plan.steps.filter((step) => step.status === "completed").length} of{" "}
                        {mission.plan.steps.length} steps validated as complete.
                      </p>
                      {mission.plan.steps.some(
                        (step) => step.status === "failed" || step.status === "skipped",
                      ) && (
                        <p className="mt-2 text-xs text-amber-100/75">
                          Unresolved work:{" "}
                          {mission.plan.steps
                            .filter((step) => step.status === "failed" || step.status === "skipped")
                            .map((step) => step.description)
                            .join("; ")}
                        </p>
                      )}
                    </section>
                  )}

                  {notice && (
                    <p
                      role="alert"
                      className="rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3 text-xs text-red-100/85"
                    >
                      {notice}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                    {(mission.status === "planned" || mayRecoverRunning) && (
                      <button
                        type="button"
                        disabled={executionPending}
                        onClick={() => void startMission()}
                        className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
                      >
                        {executionPending ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        {mayRecoverRunning ? "Resume interrupted mission" : "Start / continue"}
                      </button>
                    )}
                    {mission.status === "running" && !mayRecoverRunning && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void sendAction("pause")}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-xs text-white/80 hover:bg-white/[0.06]"
                      >
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </button>
                    )}
                    {mission.status === "paused" && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void sendAction("resume").then(() => void startMission())}
                        className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
                      >
                        <Play className="h-3.5 w-3.5" /> Resume
                      </button>
                    )}
                    {mayRetry && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void sendAction("retry")}
                        className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 px-4 py-2 text-xs text-cyan-100 hover:bg-cyan-300/[0.08]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Retry step
                      </button>
                    )}
                    {(mission.status === "completed" || mission.status === "failed") &&
                      mission.result && (
                        <button
                          type="button"
                          onClick={() => setResultsVisible((visible) => !visible)}
                          className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-xs text-white/80 hover:bg-white/[0.06]"
                        >
                          <Eye className="h-3.5 w-3.5" />{" "}
                          {resultsVisible ? "Hide results" : "View results"}
                        </button>
                      )}
                    {isActive(mission.status) && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void sendAction("cancel")}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200/15 px-4 py-2 text-xs text-red-100/75 hover:bg-red-200/[0.06]"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </button>
                    )}
                    {mission.status === "completed" && (
                      <a
                        href="/create-apka-jalwa"
                        className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-xs text-white/75 hover:bg-white/[0.06]"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Create another
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center">
                  <div className="mb-5 text-center">
                    <motion.div
                      aria-hidden="true"
                      className="mx-auto mb-4 h-14 w-14 rounded-full bg-cyan-300/15 shadow-[0_0_35px_rgba(34,211,238,0.25)] ring-1 ring-cyan-100/20"
                      animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.7, 1, 0.7] }}
                      transition={{ duration: 3.5, repeat: Infinity }}
                    />
                    <h2 className="text-lg font-semibold">What should LORD accomplish?</h2>
                    <p className="mt-1 text-xs text-white/50">
                      LORD will propose a bounded plan. Tools only run after you start, and
                      consequential actions require approval.
                    </p>
                  </div>
                  <textarea
                    value={objective}
                    onChange={(event) => {
                      planRequestId.current = null;
                      setObjective(event.target.value);
                    }}
                    maxLength={2_000}
                    rows={5}
                    aria-label="Mission objective"
                    placeholder="For example: explain how photosynthesis works, then review this code for security issues…"
                    className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white outline-none placeholder:text-white/30 focus-visible:ring-2 focus-visible:ring-cyan-400"
                  />
                  <div className="mt-2 flex items-center justify-between text-[10px] text-white/35">
                    <span>
                      {availableActions.length
                        ? `Available: ${availableActions.join(" · ")}`
                        : "No configured tools are available."}
                    </span>
                    <span>{objective.length}/2000</span>
                  </div>
                  {notice && (
                    <p
                      role="alert"
                      className="mt-3 rounded-lg border border-red-300/20 bg-red-300/[0.05] p-3 text-xs text-red-100/85"
                    >
                      {notice}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!objective.trim() || loading || availableActions.length === 0}
                    onClick={() => void createPlan()}
                    className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-sky-300 px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {loading ? "Planning mission…" : "Plan mission"}
                  </button>
                  {loading && (
                    <p role="status" className="mt-3 text-center text-xs text-white/45">
                      Validating available tools and dependencies…
                    </p>
                  )}
                </div>
              )}
            </main>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
