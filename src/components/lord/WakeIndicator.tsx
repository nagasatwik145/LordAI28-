import { Mic, MicOff } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useWakeWord } from "./WakeWordProvider";

/**
 * WakeIndicator - Shows voice input status in the corner
 */
export function WakeIndicator() {
  const { enabled, supported, stop } = useWakeWord();
  const navigate = useNavigate();
  const location = useLocation();

  const openVoiceAssistant = () => {
    if (enabled) {
      stop();
      if (location.pathname === "/voice") return;
    }
    void navigate({ to: "/voice" });
  };

  if (location.pathname === "/voice") return null;

  return (
    <button
      onClick={openVoiceAssistant}
      disabled={!supported}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full transition-all md:bottom-6 md:right-6"
      aria-label={enabled ? "Stop voice assistant" : "Open voice assistant and enable microphone"}
      aria-pressed={enabled}
      style={{
        background: enabled ? "var(--hud)" : "var(--background)",
        border: "2px solid var(--hud)",
        boxShadow: enabled ? "0 0 20px var(--hud)" : "none",
      }}
      title={enabled ? "Stop voice assistant" : "Open voice assistant"}
    >
      {enabled ? (
        <Mic className="h-5 w-5 text-background animate-pulse" />
      ) : (
        <MicOff className="h-5 w-5 text-muted-foreground" />
      )}
    </button>
  );
}
