import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  ArrowLeft,
  History,
  Mic,
  MicOff,
  Plus,
  RotateCcw,
  Subtitles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/lord/AppShell";
import { EnergyOrb } from "@/components/lord/EnergyOrb";
import { useWakeWord } from "@/components/lord/WakeWordProvider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { usePersistedState } from "@/lib/use-persisted-state";
import { cn } from "@/lib/utils";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { parseVoiceMissionCommand, type VoiceMissionCommand } from "@/lib/voice/mission-command";

export const Route = createFileRoute("/_authenticated/voice")({
  head: () => ({ meta: [{ title: "LORD AI — Voice Assistant" }] }),
  validateSearch: z.object({ conversationId: z.string().uuid().optional() }).catch({}),
  component: VoicePage,
});

type MissionStatus = "planned" | "running" | "paused" | "completed" | "failed" | "cancelled";

interface VoiceMissionStep {
  id: string;
  title: string;
  instruction: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
}

interface VoiceMission {
  id: string;
  goal: string;
  title: string;
  status: MissionStatus;
  steps: VoiceMissionStep[];
  progress: { completed: number; total: number; percent: number };
}

type PendingMissionAction =
  | { action: "plan"; goal: string; heard: string }
  | {
      action: "run" | "resume" | "pause" | "cancel";
      missionId: string;
      title: string;
      heard: string;
    };

async function readMissionResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message || "Mission request failed.");
  return body;
}

function VoicePage() {
  const { conversationId: linkedConversationId } = Route.useSearch();
  const {
    enabled,
    supported,
    state,
    errorMessage,
    transcript,
    wakePhrase,
    reply,
    messages,
    activeConversationId,
    voiceOutputEnabled,
    voiceOutputSupported,
    toggle,
    enable,
    startTapToTalk,
    submitText,
    retryLast,
    loadConversation,
    startNewConversation,
    stopSpeaking,
    stop,
    setVoiceOutputEnabled,
    stopListening,
    setCommandHandler,
  } = useWakeWord();
  const [subtitlesEnabled, setSubtitlesEnabled] = usePersistedState("voice-subtitles", true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [typedCommand, setTypedCommand] = useState("");
  const [pendingMissionAction, setPendingMissionAction] = useState<PendingMissionAction | null>(
    null,
  );
  const [missionBusy, setMissionBusy] = useState(false);
  const [missionNotice, setMissionNotice] = useState("");
  const [missionResult, setMissionResult] = useState<VoiceMission | null>(null);
  const [recentMissions, setRecentMissions] = useState<VoiceMission[]>([]);
  const initialConversationHandledRef = useRef(false);
  const proQuery = useQuery({
    queryKey: ["pro-entitlement"],
    queryFn: async () => {
      const response = await authenticatedFetch("/api/billing/status");
      if (!response.ok) throw new Error("Could not verify your plan.");
      return response.json() as Promise<{ pro: boolean; lifetime: boolean }>;
    },
  });
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stayAtBottomRef = useRef(true);
  const { data: userId } = useQuery({
    queryKey: ["voice-history-user"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      return data.user?.id ?? null;
    },
  });
  const historyQuery = useQuery({
    queryKey: ["voice-conversations", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, last_message_at")
        .eq("user_id", userId!)
        .contains("metadata", { source: "voice" })
        .order("last_message_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const fetchMissionList = useCallback(async () => {
    const response = await authenticatedFetch("/api/voice/missions", { cache: "no-store" });
    const data = await readMissionResponse<{ missions: VoiceMission[] }>(response);
    setRecentMissions(data.missions);
    return data.missions;
  }, []);

  const postMissionAction = useCallback(async (action: string, values: Record<string, string>) => {
    const response = await authenticatedFetch("/api/voice/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...values }),
    });
    return readMissionResponse<{ mission: VoiceMission; progress: VoiceMission["progress"] }>(
      response,
    );
  }, []);

  const prepareMissionAction = useCallback(
    async (command: VoiceMissionCommand, heard: string) => {
      setMissionBusy(true);
      try {
        if (command.action === "progress") {
          const missions = await fetchMissionList();
          const mission = missions.find((item) => item.status === "running") ?? missions[0] ?? null;
          setMissionResult(mission);
          setMissionNotice(
            mission
              ? `${mission.title}: ${mission.progress.percent}% complete (${mission.progress.completed} of ${mission.progress.total} steps). Status: ${mission.status}.`
              : "There are no saved missions yet. Say “start mission to …” to plan one.",
          );
          return;
        }

        const missions = await fetchMissionList();
        const eligible = missions.filter((mission) => {
          if (command.action === "pause") return mission.status === "running";
          if (command.action === "resume") return mission.status === "paused";
          return ["planned", "running", "paused"].includes(mission.status);
        });
        if (eligible.length !== 1) {
          setMissionNotice(
            eligible.length === 0
              ? `There is no ${command.action === "pause" ? "running" : command.action === "resume" ? "paused" : "active"} mission to ${command.action}.`
              : `I found ${eligible.length} possible missions. Open Mission Control and choose one explicitly; no mission was changed.`,
          );
          return;
        }
        const mission = eligible[0];
        setMissionResult(mission);
        setPendingMissionAction({
          action: command.action,
          missionId: mission.id,
          title: mission.title,
          heard,
        });
        setMissionNotice("");
      } catch (error) {
        setMissionNotice(error instanceof Error ? error.message : "Could not inspect missions.");
      } finally {
        setMissionBusy(false);
      }
    },
    [fetchMissionList],
  );

  const handleVoiceCommand = useCallback(
    (heard: string) => {
      const command = parseVoiceMissionCommand(heard);
      if (!command) return false;
      setPendingMissionAction(null);
      setMissionResult(null);
      setMissionNotice("");
      if (command.action === "start") {
        setPendingMissionAction({ action: "plan", goal: command.goal, heard });
      } else {
        void prepareMissionAction(command, heard);
      }
      return true;
    },
    [prepareMissionAction],
  );

  useEffect(() => {
    setCommandHandler(handleVoiceCommand);
    return () => setCommandHandler(null);
  }, [handleVoiceCommand, setCommandHandler]);

  const confirmMissionAction = useCallback(async () => {
    if (!pendingMissionAction || missionBusy) return;
    const pending = pendingMissionAction;
    setMissionBusy(true);
    setMissionNotice("");
    try {
      if (pending.action === "plan") {
        const result = await postMissionAction("plan", { goal: pending.goal });
        const mission = { ...result.mission, progress: result.progress };
        setMissionResult(mission);
        setPendingMissionAction({
          action: "run",
          missionId: mission.id,
          title: mission.title,
          heard: pending.heard,
        });
        setMissionNotice(
          "Plan ready. Review the steps below. LORD will only generate text results; it cannot browse, edit files, or perform external actions.",
        );
        return;
      }

      const result = await postMissionAction(pending.action, { missionId: pending.missionId });
      setMissionResult({ ...result.mission, progress: result.progress });
      setPendingMissionAction(null);
      setMissionNotice(
        pending.action === "cancel"
          ? `${pending.title} was cancelled.`
          : pending.action === "pause"
            ? `${pending.title} was paused.`
            : `${pending.title} ${pending.action === "run" ? "started" : "resumed"}.`,
      );
      await fetchMissionList();
    } catch (error) {
      setMissionNotice(error instanceof Error ? error.message : "Mission request failed.");
    } finally {
      setMissionBusy(false);
    }
  }, [fetchMissionList, pendingMissionAction, missionBusy, postMissionAction]);

  useEffect(() => {
    if (initialConversationHandledRef.current) return;
    initialConversationHandledRef.current = true;
    if (linkedConversationId) void loadConversation(linkedConversationId);
  }, [linkedConversationId, loadConversation]);

  useEffect(() => {
    if (stayAtBottomRef.current && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages, transcript, reply, pendingMissionAction, missionNotice]);

  const onTranscriptScroll = () => {
    const element = transcriptRef.current;
    if (!element) return;
    stayAtBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  };

  const status = {
    disabled: "Ready when you are",
    requesting_permission: "Requesting microphone access",
    wake_listening: "Listening for ‘Hey, LORD’",
    activated: "LORD activated",
    command_listening: "Listening to your command",
    processing: "Thinking",
    speaking: "Speaking",
    review: "Review the recognized command",
    error: "Voice assistant needs attention",
  }[state];

  const onSubmitText = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const command = typedCommand.trim();
    if (!command) return;
    setTypedCommand("");
    void submitText(command);
  };

  if (!proQuery.data?.pro)
    return (
      <AppShell>
        <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-4 text-center">
          <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
            <Mic className="h-8 w-8" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">
            LORD Pro feature
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold">
            Your voice, connected to LORD.
          </h1>
          <p className="mt-3 max-w-lg text-muted-foreground">
            Upgrade to use hands-free voice conversations, spoken responses, and premium voice
            controls.
          </p>
          {proQuery.isLoading ? (
            <p className="mt-6 text-sm text-muted-foreground">Checking your plan…</p>
          ) : (
            <Link
              to="/upgrade"
              className="mt-7 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-lg shadow-primary/20"
            >
              Explore LORD Pro
            </Link>
          )}
        </main>
      </AppShell>
    );

  return (
    <AppShell>
      <main className="voice-assistant mx-auto flex min-h-[calc(100svh-10rem)] w-full max-w-5xl flex-col items-center px-2 pb-6 sm:px-4">
        <header className="flex w-full items-center justify-between gap-4 py-2">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full border border-cyan-200/20 bg-cyan-300/5 text-cyan-100">
              <span className="font-display text-sm font-semibold">L</span>
            </div>
            <div>
              <p className="font-display text-sm font-semibold tracking-[0.22em] text-foreground">
                LORD AI
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Voice interface
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/chat"
              search={{ conversationId: activeConversationId ?? undefined }}
              onClick={stop}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/60 px-3 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Continue this conversation in text chat"
            >
              <span className="hidden sm:inline">Text chat</span>
            </Link>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/60 px-3 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Open voice chat history"
            >
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">History</span>
            </button>
            <Link
              to="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/60 px-3 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={stop}
            >
              <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Close</span>
            </Link>
          </div>
        </header>

        <section className="flex w-full flex-1 flex-col items-center justify-center py-3 text-center">
          <div
            className="voice-orb-state"
            data-state={state === "disabled" ? "idle" : state}
            aria-hidden="true"
          >
            <EnergyOrb />
          </div>
          <p
            className={cn(
              "mt-1 font-mono text-xs uppercase tracking-[0.22em] sm:text-sm",
              state === "error" ? "text-amber-200" : "text-cyan-100/90",
            )}
            aria-live="polite"
          >
            {status}
          </p>
          {state === "disabled" && (
            <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
              Enable voice or tap to talk. LORD listens only while this page is open and in the
              foreground; background wake-word listening is not supported.
            </p>
          )}
          {!supported && (
            <p role="status" className="mt-2 max-w-md text-xs leading-relaxed text-amber-100/80">
              This browser does not provide speech recognition. You can still send commands using
              the text box below.
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => (enabled ? toggle() : void enable())}
              disabled={!supported}
              aria-label={
                enabled
                  ? "Stop voice assistant and mute microphone"
                  : "Enable voice assistant microphone"
              }
              aria-pressed={enabled}
              className={cn(
                "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                enabled
                  ? "border-cyan-200/40 bg-cyan-200/10 text-cyan-100 hover:bg-cyan-200/15"
                  : "border-primary/50 bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {enabled ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {enabled ? "Mute microphone" : "Enable voice"}
            </button>
            <button
              type="button"
              onClick={() =>
                state === "command_listening" ? stopListening() : void startTapToTalk()
              }
              disabled={
                !supported ||
                state === "processing" ||
                state === "requesting_permission" ||
                state === "review"
              }
              aria-label={
                state === "command_listening"
                  ? "Stop listening"
                  : state === "speaking"
                    ? "Interrupt LORD and start listening"
                    : "Tap to talk"
              }
              className="inline-flex min-h-12 items-center gap-2 rounded-full border border-border/70 px-4 text-sm text-foreground/85 transition hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {state === "command_listening" ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              {state === "command_listening"
                ? "Stop listening"
                : state === "speaking"
                  ? "Interrupt & talk"
                  : "Tap to talk"}
            </button>
            {state === "speaking" && (
              <button
                type="button"
                onClick={stopSpeaking}
                className="inline-flex min-h-12 items-center gap-2 rounded-full border border-border/70 px-4 text-sm text-foreground/85 transition hover:border-primary/40"
              >
                <VolumeX className="h-4 w-4" /> Stop speaking
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <button
              type="button"
              onClick={() => setSubtitlesEnabled((current) => !current)}
              aria-pressed={subtitlesEnabled}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Subtitles className="h-4 w-4" /> Subtitles {subtitlesEnabled ? "on" : "off"}
            </button>
            <button
              type="button"
              onClick={() => setVoiceOutputEnabled(!voiceOutputEnabled)}
              disabled={!voiceOutputSupported}
              aria-pressed={voiceOutputEnabled}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45"
            >
              {voiceOutputEnabled ? (
                <Volume2 className="h-4 w-4" />
              ) : (
                <VolumeX className="h-4 w-4" />
              )}
              Spoken replies {voiceOutputEnabled ? "on" : "off"}
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={startNewConversation}
                className="min-h-10 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                New voice chat
              </button>
            )}
          </div>
        </section>

        <section
          className="mb-4 w-full max-w-3xl rounded-xl border border-cyan-200/15 bg-cyan-200/[0.035] p-4 text-left"
          aria-labelledby="voice-mission-title"
        >
          <h2 id="voice-mission-title" className="font-semibold text-cyan-100">
            Mission control
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Say “start mission to …”, “pause mission”, “resume mission”, “cancel mission”, or “check
            mission progress”. LORD shows the recognized words and asks you to confirm every change
            before it happens.
          </p>
          {pendingMissionAction && (
            <div className="mt-3 rounded-lg border border-amber-200/20 bg-amber-200/[0.04] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-100">
                Please review what LORD heard
              </p>
              <blockquote className="mt-2 break-words text-sm text-foreground">
                “{pendingMissionAction.heard}”
              </blockquote>
              <p className="mt-2 text-xs text-muted-foreground">
                {pendingMissionAction.action === "plan"
                  ? `Create a proposed plan for: ${pendingMissionAction.goal}`
                  : `${pendingMissionAction.action} mission: ${pendingMissionAction.title}`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void confirmMissionAction()}
                  disabled={missionBusy}
                  className="min-h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {missionBusy
                    ? "Working…"
                    : pendingMissionAction.action === "plan"
                      ? "Confirm plan"
                      : pendingMissionAction.action === "run"
                        ? "Confirm and run"
                        : pendingMissionAction.action === "resume"
                          ? "Confirm and resume"
                          : pendingMissionAction.action === "pause"
                            ? "Confirm pause"
                            : "Confirm cancellation"}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingMissionAction(null)}
                  disabled={missionBusy}
                  className="min-h-10 rounded-lg border border-border/70 px-4 text-sm text-foreground disabled:opacity-50"
                >
                  Do not proceed
                </button>
              </div>
            </div>
          )}
          {missionNotice && (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 rounded-lg border border-border/50 bg-background/35 p-3 text-sm text-foreground/90"
            >
              {missionNotice}
            </p>
          )}
          {missionResult && (
            <div className="mt-3 rounded-lg border border-border/50 bg-background/25 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">{missionResult.title}</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {missionResult.goal}
                  </p>
                </div>
                <span className="rounded-full border border-cyan-200/20 px-2 py-1 text-xs text-cyan-100">
                  {missionResult.status}
                </span>
              </div>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"
                role="progressbar"
                aria-valuenow={missionResult.progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Mission progress"
              >
                <div
                  className="h-full bg-cyan-300 transition-[width]"
                  style={{ width: `${missionResult.progress.percent}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {missionResult.progress.completed} of {missionResult.progress.total} steps complete
              </p>
              <ol className="mt-3 space-y-2">
                {missionResult.steps.map((step, index) => (
                  <li key={step.id} className="border-t border-border/40 pt-2 text-sm">
                    <p>
                      {index + 1}. {step.title}{" "}
                      <span className="text-muted-foreground">· {step.status}</span>
                    </p>
                    {step.result && (
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {step.result}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {recentMissions.length > 0 && (
            <details className="mt-3">
              <summary className="min-h-10 cursor-pointer py-2 text-xs font-medium text-cyan-100">
                Recent missions ({recentMissions.length})
              </summary>
              <ul className="space-y-2">
                {recentMissions.slice(0, 5).map((mission) => (
                  <li
                    key={mission.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2 text-xs"
                  >
                    <span className="min-w-0 break-words text-foreground">{mission.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {mission.status} · {mission.progress.percent}%
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <p className="mb-4 max-w-3xl text-center text-[11px] leading-relaxed text-muted-foreground">
          Microphone permission is requested only after you activate voice. Your browser or Android
          speech service may process audio remotely; LORD receives recognized text, not an audio
          recording. Audio is not saved by LORD. Text chat remains available if speech is
          unsupported or permission is denied.
        </p>

        {errorMessage && (
          <section
            role="alert"
            className="mb-4 w-full max-w-2xl rounded-xl border border-amber-300/25 bg-amber-300/5 p-3 text-sm text-amber-100"
          >
            <p>{errorMessage}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {state === "error" && supported && (
                <button
                  type="button"
                  onClick={() => void enable()}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-100/25 px-3 text-xs hover:bg-amber-100/5"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Retry microphone
                </button>
              )}
              {messages.some((message) => message.role === "user") && (
                <button
                  type="button"
                  onClick={() => void retryLast()}
                  className="min-h-10 rounded-lg border border-amber-100/25 px-3 text-xs hover:bg-amber-100/5"
                >
                  Retry last command
                </button>
              )}
            </div>
          </section>
        )}

        {subtitlesEnabled && (
          <section
            className="w-full max-w-3xl border-t border-border/40 pt-3"
            aria-label="Voice subtitles"
          >
            <div
              ref={transcriptRef}
              onScroll={onTranscriptScroll}
              className="max-h-56 space-y-3 overflow-y-auto px-1 py-2 sm:max-h-64"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {wakePhrase && (
                <p className="text-xs text-cyan-100/65">Wake phrase: “{wakePhrase}”</p>
              )}
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    "max-w-[90%] text-left",
                    message.role === "user" ? "ml-auto" : "mr-auto",
                  )}
                >
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                    {message.role === "user" ? "You" : "LORD AI"}
                  </p>
                  <p className="whitespace-pre-wrap rounded-xl border border-border/40 bg-background/35 px-3 py-2 text-sm leading-relaxed text-foreground/90">
                    {message.text}
                  </p>
                </article>
              ))}
              {transcript &&
                (state === "command_listening" ||
                  state === "wake_listening" ||
                  state === "review") && (
                  <article className="ml-auto max-w-[90%] text-left">
                    <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                      {state === "wake_listening"
                        ? "Wake recognition · live"
                        : state === "review"
                          ? "You · review before action"
                          : "You · live"}
                    </p>
                    <p className="whitespace-pre-wrap rounded-xl border border-cyan-200/15 bg-cyan-200/5 px-3 py-2 text-sm text-foreground/80">
                      {transcript}
                    </p>
                  </article>
                )}
              {reply && state === "processing" && (
                <article className="mr-auto max-w-[90%] text-left">
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                    LORD AI · response
                  </p>
                  <p className="whitespace-pre-wrap rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm leading-relaxed text-foreground/90">
                    {reply}
                  </p>
                </article>
              )}
              {!messages.length && !wakePhrase && !transcript && (
                <p className="py-5 text-center text-xs text-muted-foreground">
                  Your transcript and LORD’s actual responses will appear here.
                </p>
              )}
            </div>
          </section>
        )}

        <form onSubmit={onSubmitText} className="mt-3 flex w-full max-w-3xl items-center gap-2">
          <label className="sr-only" htmlFor="voice-text-fallback">
            Type a command
          </label>
          <input
            id="voice-text-fallback"
            value={typedCommand}
            onChange={(event) => setTypedCommand(event.target.value)}
            placeholder="Type a command if speech recognition is unavailable…"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-border/50 bg-background/45 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/65 focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
          />
          <button
            type="submit"
            disabled={!typedCommand.trim() || state === "processing"}
            className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-45"
          >
            Send
          </button>
        </form>
      </main>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          side="left"
          className="flex w-[min(88vw,24rem)] max-w-none flex-col border-border/70 bg-background/95 p-3 pt-12 sm:p-5 sm:pt-12"
        >
          <SheetHeader className="mb-4 text-left">
            <SheetTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-cyan-200" /> Voice chat history
            </SheetTitle>
            <SheetDescription>Saved voice conversations from this account.</SheetDescription>
          </SheetHeader>
          <button
            type="button"
            onClick={() => {
              startNewConversation();
              setHistoryOpen(false);
            }}
            className="mb-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary/15 px-3 text-sm font-medium text-primary transition hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" /> New voice chat
          </button>
          <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto">
            {historyQuery.isPending ? (
              <p className="px-2 py-5 text-center text-sm text-muted-foreground">
                Loading voice history…
              </p>
            ) : historyQuery.error ? (
              <div role="alert" className="rounded-xl border border-amber-200/20 p-3 text-sm">
                <p className="text-amber-100">Could not load voice history.</p>
                <button
                  type="button"
                  onClick={() => void historyQuery.refetch()}
                  className="mt-2 min-h-10 rounded-lg px-2 text-xs text-cyan-100 hover:bg-cyan-100/10"
                >
                  Try again
                </button>
              </div>
            ) : historyQuery.data?.length ? (
              historyQuery.data.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  disabled={state === "processing" || state === "speaking"}
                  onClick={() => {
                    void loadConversation(conversation.id);
                    setHistoryOpen(false);
                  }}
                  aria-current={activeConversationId === conversation.id ? "true" : undefined}
                  className={cn(
                    "block min-h-14 w-full rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    activeConversationId === conversation.id
                      ? "border-primary/50 bg-primary/10"
                      : "border-border/50 bg-background/35 hover:border-primary/30 hover:bg-primary/5",
                  )}
                >
                  <span className="block truncate text-sm font-medium text-foreground">
                    {conversation.title || "Voice conversation"}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {conversation.last_message_at
                      ? new Date(conversation.last_message_at).toLocaleString()
                      : "Saved conversation"}
                  </span>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center">
                <p className="text-sm text-foreground/85">No saved voice chats yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your conversations will appear here after your first voice command.
                </p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
