import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Mic, MicOff, X } from "lucide-react";
import { useWakeWord } from "./WakeWordProvider";

function describeState(state: ReturnType<typeof useWakeWord>["state"]) {
  switch (state) {
    case "activated":
    case "command_listening":
      return "Listening to your request";
    case "processing":
      return "LORD AI is thinking";
    case "speaking":
      return "LORD AI is responding";
    case "error":
      return "Voice activation needs attention";
    case "review":
      return "Review this voice command";
    default:
      return "Say “Hey Lord” to ask again";
  }
}

export function FloatingWakeAssistant() {
  const {
    enabled,
    state,
    errorMessage,
    transcript,
    wakePhrase,
    reply,
    stop,
    activeConversationId,
  } = useWakeWord();
  const location = useLocation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (state === "activated") setDismissed(false);
  }, [state]);

  if (
    !wakePhrase ||
    dismissed ||
    location.pathname === "/voice" ||
    state === "disabled" ||
    state === "paused"
  ) {
    return null;
  }

  const visibleTranscript =
    transcript && transcript.toLowerCase().trim() !== wakePhrase.toLowerCase().trim()
      ? transcript
      : "Listening for your request…";

  return (
    <section
      aria-label="LORD AI voice assistant"
      className="fixed inset-x-3 z-[60] mx-auto max-w-xl rounded-[28px] border border-cyan-200/20 bg-[#080d18]/95 p-4 text-white shadow-[0_16px_60px_rgba(0,0,0,.55),0_0_30px_rgba(39,190,255,.14)] backdrop-blur-2xl sm:inset-x-6 sm:p-5"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-cyan-200/30 bg-[#0a0e1a] shadow-[0_0_20px_rgba(40,190,255,.18)]">
          <img src="/lord-icon.png" alt="" className="h-10 w-10 object-contain" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/75">
            LORD AI
          </p>
          <p className="mt-0.5 text-sm font-medium text-white">Ask LORD AI</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
          aria-label="Dismiss LORD AI assistant panel"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs text-cyan-100/80">
        <span
          className={`h-2 w-2 rounded-full ${state === "error" ? "bg-amber-300" : "animate-pulse bg-cyan-300"}`}
          aria-hidden="true"
        />
        {describeState(state)}
      </p>

      <div className="mt-3 max-h-32 space-y-2 overflow-y-auto rounded-2xl border border-white/5 bg-white/[0.035] p-3 text-sm">
        {errorMessage ? (
          <p className="text-amber-100/90">{errorMessage}</p>
        ) : (
          <p className="break-words text-white/80">{visibleTranscript}</p>
        )}
        {reply && <p className="break-words text-cyan-50">{reply}</p>}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={stop}
          disabled={!enabled && state !== "error"}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 px-4 text-xs font-medium text-white/85 transition hover:border-cyan-200/40 hover:bg-white/5 disabled:opacity-45"
          aria-label="Stop LORD AI voice listening"
        >
          <MicOff className="h-4 w-4" />
          Stop listening
        </button>
        <button
          type="button"
          onClick={() =>
            void navigate({
              to: "/voice",
              search: activeConversationId ? { conversationId: activeConversationId } : {},
            })
          }
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-cyan-200 px-4 text-xs font-semibold text-slate-950 transition hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Mic className="h-4 w-4" />
          Expand assistant
          <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
