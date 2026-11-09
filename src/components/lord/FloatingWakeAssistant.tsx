import { useState } from "react";
import { useLocation, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, Mic, MicOff, Pause, Radio, VolumeX, X } from "lucide-react";
import { useWakeWord } from "./WakeWordProvider";

function stateLabel(state: ReturnType<typeof useWakeWord>["state"]) {
  switch (state) {
    case "requesting_permission":
      return "Connecting to microphone";
    case "wake_listening":
    case "command_listening":
      return "Listening";
    case "processing":
      return "Thinking";
    case "speaking":
      return "Speaking";
    case "paused":
      return "Paused";
    case "error":
      return "Needs attention";
    case "ended":
      return "Ended";
    default:
      return "Ready";
  }
}

export function FloatingWakeAssistant() {
  const {
    enabled,
    supported,
    state,
    errorMessage,
    startVoiceConversation,
    pauseVoiceConversation,
    resumeVoiceConversation,
    endVoiceConversation,
    stopSpeaking,
  } = useWakeWord();
  const location = useLocation();
  const navigate = useNavigate();
  const inAuthenticatedWorkspace = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === "/_authenticated"),
  });
  const [expanded, setExpanded] = useState(false);

  if (!inAuthenticatedWorkspace || location.pathname === "/voice") return null;

  const active = enabled || state === "speaking" || state === "processing";
  const microphoneLive = enabled && ["wake_listening", "command_listening"].includes(state);
  const stateText = stateLabel(state);

  return (
    <aside
      aria-label="LORD AI voice companion"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-3 z-[60] w-[min(22rem,calc(100vw-1.5rem))] md:bottom-5 md:right-5"
    >
      {!active && !expanded && state !== "paused" && state !== "error" ? (
        <div className="ml-auto flex w-fit flex-col items-end gap-1 rounded-[22px] border border-cyan-200/20 bg-[#080d18]/95 p-2.5 text-white shadow-[0_12px_38px_rgba(0,0,0,.5),0_0_22px_rgba(39,190,255,.14)] backdrop-blur-xl">
          <p className="max-w-56 px-1 text-right text-[10px] leading-relaxed text-white/55">
            Microphone access lets your browser speech service hear your voice while active.
          </p>
          <button
            type="button"
            disabled={!supported || state === "requesting_permission"}
            onClick={() => void startVoiceConversation()}
            className="flex min-h-10 items-center gap-2 rounded-full bg-cyan-200 px-3.5 text-xs font-semibold text-slate-950 shadow-sm transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Start voice conversation; browser will request microphone access"
          >
            <Mic className="h-4 w-4" /> Start voice
          </button>
        </div>
      ) : (
        <section className="overflow-hidden rounded-[24px] border border-cyan-200/20 bg-[#080d18]/95 text-white shadow-[0_16px_55px_rgba(0,0,0,.58),0_0_28px_rgba(39,190,255,.14)] backdrop-blur-2xl">
          <div className="flex items-center gap-3 p-3.5">
            <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-cyan-100/20 bg-[#0b1424]">
              <img src="/lord-icon.png" alt="" className="h-8 w-8 rounded-full object-contain" />
              {microphoneLive && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-[#080d18] bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,.8)]"
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-100/75">
                <span>LORD AI</span>
                {active && <span className="text-rose-300">LIVE</span>}
              </div>
              <p aria-live="polite" className="mt-0.5 truncate text-sm font-medium text-white">
                {stateText}
              </p>
            </div>
            {(active || state === "paused") && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    state === "speaking"
                      ? stopSpeaking()
                      : state === "paused"
                        ? void resumeVoiceConversation()
                        : pauseVoiceConversation()
                  }
                  aria-label={
                    state === "speaking"
                      ? "Stop voice playback"
                      : state === "paused"
                        ? "Resume voice conversation"
                        : "Mute microphone and pause voice"
                  }
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 text-white/85 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                >
                  {state === "speaking" ? (
                    <VolumeX className="h-4 w-4" />
                  ) : state === "paused" ? (
                    <Mic className="h-4 w-4" />
                  ) : (
                    <Pause className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={endVoiceConversation}
                  aria-label="End voice conversation"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rose-200/20 text-rose-100 hover:bg-rose-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                >
                  <MicOff className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-label={expanded ? "Collapse voice controls" : "Expand voice controls"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
            >
              {expanded ? <X className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
            </button>
          </div>

          {(expanded || state === "paused" || state === "error") && (
            <div className="border-t border-white/10 px-3.5 pb-3.5 pt-3">
              {active ? (
                <>
                  <p className="text-xs leading-relaxed text-white/65">
                    LORD uses your browser’s speech service while this session is active. Pause or
                    end the session at any time.
                  </p>
                  {errorMessage && (
                    <p role="alert" className="mt-2 text-xs text-amber-100">
                      {errorMessage}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        state === "speaking"
                          ? stopSpeaking()
                          : state === "paused"
                            ? void resumeVoiceConversation()
                            : pauseVoiceConversation()
                      }
                      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 px-3.5 text-xs font-medium text-white/90 hover:border-cyan-100/40 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                    >
                      {state === "speaking" ? (
                        <VolumeX className="h-4 w-4" />
                      ) : state === "paused" ? (
                        <Mic className="h-4 w-4" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                      {state === "speaking"
                        ? "Stop speaking"
                        : state === "paused"
                          ? "Resume"
                          : "Mute / pause"}
                    </button>
                    <button
                      type="button"
                      onClick={endVoiceConversation}
                      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-rose-200/25 px-3.5 text-xs font-medium text-rose-100 hover:bg-rose-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                    >
                      <MicOff className="h-4 w-4" /> End voice
                    </button>
                    <button
                      type="button"
                      onClick={() => void navigate({ to: "/voice" })}
                      className="inline-flex min-h-10 items-center gap-2 rounded-full bg-cyan-200 px-3.5 text-xs font-semibold text-slate-950 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      Expand <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-white/65">
                    Start an explicit voice session. Your browser will request microphone access;
                    speech is handled by its speech service.
                  </p>
                  {errorMessage && (
                    <p role="alert" className="mt-2 text-xs text-amber-100">
                      {errorMessage}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!supported || state === "requesting_permission"}
                    onClick={() =>
                      state === "paused"
                        ? void resumeVoiceConversation()
                        : void startVoiceConversation()
                    }
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-cyan-200 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Mic className="h-4 w-4" />
                    {state === "paused" ? "Resume voice" : "Start voice conversation"}
                  </button>
                  {!supported && (
                    <p className="mt-2 text-xs text-amber-100/80">
                      Speech recognition is unavailable in this browser. Use text chat instead.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
