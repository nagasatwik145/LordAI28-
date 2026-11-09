import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSpeechRecognitionConstructor } from "@/lib/voice/webspeech-wake-engine";
import { monitoring } from "@/lib/monitoring-service";
import type { LordMode } from "@/lib/modes";
import {
  VoicePipeline,
  type VoiceControlCommand,
  type VoiceMessage,
  type VoicePipelineStatus,
} from "@/lib/voice/voice-pipeline";
import {
  getVoiceMicrophonePermission,
  microphonePermissionError,
  requestVoiceMicrophonePermission,
} from "@/lib/voice/microphone";

export type VoiceAssistantState =
  | "disabled"
  | "requesting_permission"
  | "wake_listening"
  | "activated"
  | "command_listening"
  | "processing"
  | "speaking"
  | "paused"
  | "ended"
  | "review"
  | "error";

type LegacyWakeStatus =
  "off" | "listening" | "heard" | "thinking" | "speaking" | "error" | "unsupported";

interface WakeWordContextValue {
  enabled: boolean;
  supported: boolean;
  wakeWordAvailable: boolean;
  status: LegacyWakeStatus;
  state: VoiceAssistantState;
  errorMessage: string;
  transcript: string;
  wakePhrase: string;
  reply: string;
  messages: VoiceMessage[];
  activeConversationId: string | null;
  voiceOutputEnabled: boolean;
  voiceOutputSupported: boolean;
  toggle: () => void;
  enable: () => Promise<void>;
  stop: () => void;
  stopListening: () => void;
  startTapToTalk: () => Promise<void>;
  startVoiceConversation: () => Promise<void>;
  pauseVoiceConversation: () => void;
  resumeVoiceConversation: () => Promise<void>;
  endVoiceConversation: () => void;
  submitText: (text: string) => Promise<void>;
  setCommandHandler: (handler: ((text: string) => boolean) | null) => void;
  retryLast: () => Promise<void>;
  loadConversation: (conversationId: string) => Promise<void>;
  startNewConversation: () => void;
  stopSpeaking: () => void;
  setVoiceOutputEnabled: (enabled: boolean) => void;
  clearMessages: () => void;
}

const WakeWordContext = createContext<WakeWordContextValue | undefined>(undefined);
const VOICE_OUTPUT_KEY = "lord-voice-output-enabled";

function asLegacyStatus(state: VoiceAssistantState, supported: boolean): LegacyWakeStatus {
  switch (state) {
    case "requesting_permission":
    case "processing":
    case "review":
      return "thinking";
    case "wake_listening":
    case "command_listening":
      return "listening";
    case "activated":
      return "heard";
    case "speaking":
      return "speaking";
    case "paused":
      return "off";
    case "error":
      return supported ? "error" : "unsupported";
    default:
      return "off";
  }
}

function getVoicePageContext(pathname: string) {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  if (segments.includes("tutor")) return "LORD AI section: Tutor";
  if (segments.includes("study") || segments.includes("learning")) return "LORD AI section: Study";
  const section = segments[0];
  const labels: Record<string, string> = {
    chat: "Chat",
    study: "Study",
    tutor: "Tutor",
    community: "Community",
    documents: "Documents",
    command: "Command Center",
    projects: "Projects",
    research: "Research",
  };
  return section ? `LORD AI section: ${labels[section] ?? "Workspace"}` : "LORD AI dashboard";
}

export function WakeWordProvider({
  children,
  mode = "balanced",
  autoSpeak = true,
  voiceRate = 1,
}: {
  children: ReactNode;
  mode?: LordMode;
  autoSpeak?: boolean;
  voiceRate?: number;
}) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [state, setState] = useState<VoiceAssistantState>("disabled");
  const [errorMessage, setErrorMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const [wakePhrase, setWakePhrase] = useState("");
  const [reply, setReply] = useState("");
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [voiceOutputEnabled, setVoiceOutputState] = useState(autoSpeak);
  const [supported, setSupported] = useState(false);
  const [voiceOutputSupported, setVoiceOutputSupported] = useState(false);
  const voiceOutputOverrideRef = useRef(false);
  const pipelineRef = useRef<VoicePipeline | null>(null);
  const permissionRequestRef = useRef(0);
  const permissionInFlightRef = useRef(false);
  const continuousSessionRef = useRef(false);
  const commandHandlerRef = useRef<((text: string) => boolean) | null>(null);
  const controlHandlerRef = useRef<(command: VoiceControlCommand) => void>(() => {});
  const enabledRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    setSupported(
      Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(getSpeechRecognitionConstructor()),
    );
    setVoiceOutputSupported("speechSynthesis" in window);
  }, []);

  const updateState = useCallback((next: VoiceAssistantState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const stop = useCallback(() => {
    permissionRequestRef.current += 1;
    permissionInFlightRef.current = false;
    enabledRef.current = false;
    continuousSessionRef.current = false;
    pipelineRef.current?.stop();
    updateState("disabled");
  }, [updateState]);

  const pauseForLifecycle = useCallback(
    (message: string) => {
      stop();
      setErrorMessage(message);
      updateState("paused");
    },
    [stop, updateState],
  );

  const setVoiceOutputEnabled = useCallback((enabled: boolean) => {
    voiceOutputOverrideRef.current = true;
    setVoiceOutputState(enabled);
    try {
      localStorage.setItem(VOICE_OUTPUT_KEY, String(enabled));
    } catch {
      // The preference remains available for this session if storage is blocked.
    }
    pipelineRef.current?.setVoiceOutput(enabled);
  }, []);

  const wirePipeline = useCallback(() => {
    if (pipelineRef.current) return pipelineRef.current;
    const pipeline = new VoicePipeline(mode, voiceOutputEnabled, voiceRate);
    pipeline.setPageContext(getVoicePageContext(location.pathname));
    pipeline.onControlCommand = (command) => controlHandlerRef.current(command);
    pipeline.onStatusChange = (pipelineStatus: VoicePipelineStatus) => {
      if (pipelineStatus === "error") {
        continuousSessionRef.current = false;
        enabledRef.current = false;
      }
      if (pipelineStatus === "wake_listening" && !continuousSessionRef.current) {
        enabledRef.current = false;
        updateState("disabled");
      } else if (pipelineStatus === "wake_listening") {
        updateState("wake_listening");
      } else {
        updateState(pipelineStatus);
      }
    };
    pipeline.onTranscript = setTranscript;
    pipeline.onResponse = setReply;
    pipeline.onCommand = (text) => commandHandlerRef.current?.(text) ?? false;
    pipeline.onError = (message) => {
      setErrorMessage(message);
      if (message) monitoring.logEvent({ type: "error", category: "voice", message });
    };
    pipeline.onMessagesChange = setMessages;
    pipeline.onConversationChange = (conversationId) => {
      setActiveConversationId(conversationId);
      if (conversationId) {
        void queryClient.invalidateQueries({ queryKey: ["voice-conversations"] });
      }
    };
    pipelineRef.current = pipeline;
    return pipeline;
  }, [location.pathname, mode, queryClient, updateState, voiceOutputEnabled, voiceRate]);

  const enable = useCallback(async () => {
    enabledRef.current = false;
    setErrorMessage(
      "A local ‘Hey Lord’ wake-word model is not bundled yet. Use Tap to Talk for voice commands.",
    );
    updateState("error");
  }, [updateState]);

  const startTapToTalk = useCallback(async () => {
    if (!supported) {
      setErrorMessage("Speech recognition is not supported. Use the text command box instead.");
      updateState("error");
      return;
    }
    if (permissionInFlightRef.current) return;
    permissionInFlightRef.current = true;
    const requestId = ++permissionRequestRef.current;
    void getVoiceMicrophonePermission().then((permission) => {
      console.info(
        JSON.stringify({ event: "voice_microphone_permission_state", state: permission }),
      );
    });
    if (!enabledRef.current) updateState("requesting_permission");
    try {
      if (!enabledRef.current) await requestVoiceMicrophonePermission();
      console.info(JSON.stringify({ event: "voice_microphone_permission_result", granted: true }));
      if (requestId !== permissionRequestRef.current) return;
      enabledRef.current = true;
    } catch (error) {
      if (requestId !== permissionRequestRef.current) return;
      console.warn(
        JSON.stringify({
          event: "voice_microphone_permission_result",
          granted: false,
          errorName: error instanceof Error ? error.name : "unknown",
        }),
      );
      enabledRef.current = false;
      setErrorMessage(microphonePermissionError(error));
      updateState("error");
      return;
    } finally {
      if (requestId === permissionRequestRef.current) permissionInFlightRef.current = false;
    }
    wirePipeline().startListening();
  }, [supported, updateState, wirePipeline]);

  const startVoiceConversation = useCallback(async () => {
    if (!supported || permissionInFlightRef.current) {
      if (!supported) {
        setErrorMessage("Continuous speech recognition is unavailable here. Use text chat.");
        updateState("error");
      }
      return;
    }
    permissionInFlightRef.current = true;
    const requestId = ++permissionRequestRef.current;
    updateState("requesting_permission");
    setErrorMessage("");
    try {
      // The Web Speech API owns microphone capture and permission. Avoid opening
      // a second getUserMedia stream alongside the recognizer.
      continuousSessionRef.current = true;
      enabledRef.current = true;
      const started = wirePipeline().startConversation();
      if (!started) {
        continuousSessionRef.current = false;
        enabledRef.current = false;
      }
    } catch (error) {
      continuousSessionRef.current = false;
      enabledRef.current = false;
      setErrorMessage(microphonePermissionError(error));
      updateState("error");
    } finally {
      if (requestId === permissionRequestRef.current) permissionInFlightRef.current = false;
    }
  }, [supported, updateState, wirePipeline]);

  const pauseVoiceConversation = useCallback(() => {
    continuousSessionRef.current = false;
    enabledRef.current = false;
    pipelineRef.current?.pauseConversation();
    updateState("paused");
  }, [updateState]);

  const endVoiceConversation = useCallback(() => {
    permissionRequestRef.current += 1;
    permissionInFlightRef.current = false;
    enabledRef.current = false;
    continuousSessionRef.current = false;
    pipelineRef.current?.stop();
    setErrorMessage("");
    updateState("ended");
  }, [updateState]);

  const resumeVoiceConversation = useCallback(async () => {
    if (!supported || permissionInFlightRef.current) return;
    permissionInFlightRef.current = true;
    const requestId = ++permissionRequestRef.current;
    updateState("requesting_permission");
    try {
      continuousSessionRef.current = true;
      enabledRef.current = true;
      if (!wirePipeline().resumeConversation()) {
        continuousSessionRef.current = false;
        enabledRef.current = false;
      }
    } catch (error) {
      continuousSessionRef.current = false;
      enabledRef.current = false;
      setErrorMessage(microphonePermissionError(error));
      updateState("error");
    } finally {
      if (requestId === permissionRequestRef.current) permissionInFlightRef.current = false;
    }
  }, [supported, updateState, wirePipeline]);

  const submitText = useCallback(
    async (text: string) => {
      await wirePipeline().submitText(text);
    },
    [wirePipeline],
  );
  const stopListening = useCallback(() => {
    if (stateRef.current !== "command_listening") return;
    if (continuousSessionRef.current) {
      pipelineRef.current?.pauseConversation();
      continuousSessionRef.current = false;
      enabledRef.current = false;
      updateState("paused");
      return;
    }
    enabledRef.current = false;
    pipelineRef.current?.stopListening();
    updateState("disabled");
  }, [updateState]);
  const setCommandHandler = useCallback((handler: ((text: string) => boolean) | null) => {
    commandHandlerRef.current = handler;
  }, []);
  const retryLast = useCallback(() => wirePipeline().retryLast(), [wirePipeline]);
  const loadConversation = useCallback(
    async (conversationId: string) => {
      stop();
      setErrorMessage("");
      setWakePhrase("");
      try {
        await wirePipeline().loadConversation(conversationId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load voice history.";
        setErrorMessage(message);
        updateState("error");
      }
    },
    [stop, updateState, wirePipeline],
  );
  const startNewConversation = useCallback(() => {
    stop();
    wirePipeline().startNewConversation();
    setWakePhrase("");
    setErrorMessage("");
  }, [stop, wirePipeline]);
  const stopSpeaking = useCallback(() => pipelineRef.current?.stopSpeaking(), []);
  const clearMessages = useCallback(() => {
    startNewConversation();
  }, [startNewConversation]);
  const toggle = useCallback(() => {
    if (enabledRef.current || stateRef.current === "requesting_permission") stop();
    else void enable();
  }, [enable, stop]);

  useEffect(() => {
    pipelineRef.current?.setPageContext(getVoicePageContext(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    controlHandlerRef.current = (command) => {
      switch (command) {
        case "pause":
          pauseVoiceConversation();
          break;
        case "resume":
          if (stateRef.current === "paused" || continuousSessionRef.current) {
            void resumeVoiceConversation();
          }
          break;
        case "repeat":
          if (!pipelineRef.current?.repeatLastResponse()) {
            setErrorMessage("There is no LORD reply to repeat yet.");
          }
          break;
        case "slower":
          pipelineRef.current?.speakSlower();
          setErrorMessage("I’ll speak more slowly from now on.");
          break;
        case "stop-speaking":
          pipelineRef.current?.stopSpeaking();
          break;
        case "end":
          endVoiceConversation();
          break;
      }
    };
  }, [endVoiceConversation, pauseVoiceConversation, resumeVoiceConversation]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
      continuousSessionRef.current = false;
      enabledRef.current = false;
      pipelineRef.current?.startNewConversation();
      setMessages([]);
      setActiveConversationId(null);
      setErrorMessage("");
      updateState("ended");
    });
    return () => data.subscription.unsubscribe();
  }, [updateState]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VOICE_OUTPUT_KEY);
      if (saved !== null) {
        voiceOutputOverrideRef.current = true;
        setVoiceOutputState(saved === "true" && voiceOutputSupported);
      } else if (!voiceOutputOverrideRef.current) {
        setVoiceOutputState(autoSpeak && voiceOutputSupported);
      }
    } catch {
      // Keep the setting supplied by the account profile.
    }
  }, [autoSpeak, voiceOutputSupported]);

  useEffect(() => {
    pipelineRef.current?.setVoiceOutput(voiceOutputEnabled);
  }, [voiceOutputEnabled]);

  useEffect(() => {
    const handleVisibility = () => {
      if (
        document.visibilityState === "hidden" &&
        [
          "requesting_permission",
          "wake_listening",
          "activated",
          "command_listening",
          "processing",
          "speaking",
        ].includes(stateRef.current)
      ) {
        pauseForLifecycle(
          "Voice mode paused because this tab is in the background. Enable it again when you return.",
        );
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [pauseForLifecycle]);

  useEffect(() => {
    let disposed = false;
    let permission: PermissionStatus | null = null;
    const handlePermissionChange = () => {
      if (!permission || permission.state !== "denied" || !enabledRef.current) return;
      stop();
      setErrorMessage(
        "Microphone permission was revoked. Allow microphone access in browser settings, then resume voice.",
      );
      updateState("error");
    };
    if (navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then((status) => {
          if (disposed) return;
          permission = status;
          permission.addEventListener("change", handlePermissionChange);
        })
        .catch(() => undefined);
    }
    const handleDeviceChange = () => {
      if (!enabledRef.current || !navigator.mediaDevices?.enumerateDevices) return;
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (!enabledRef.current || devices.some((device) => device.kind === "audioinput")) return;
        stop();
        setErrorMessage("The microphone was disconnected. Reconnect it and resume voice.");
        updateState("error");
      });
    };
    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    return () => {
      disposed = true;
      permission?.removeEventListener("change", handlePermissionChange);
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [stop, updateState]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let listener: PluginListenerHandle | null = null;
    void App.addListener("appStateChange", ({ isActive }) => {
      if (
        active &&
        !isActive &&
        [
          "requesting_permission",
          "wake_listening",
          "activated",
          "command_listening",
          "processing",
          "speaking",
        ].includes(stateRef.current)
      ) {
        pauseForLifecycle(
          "Voice mode paused because LORD is in the background. Return to the app and activate voice manually.",
        );
      }
    })
      .then((handle) => {
        if (!active) void handle.remove();
        else listener = handle;
      })
      .catch((error: unknown) => {
        console.error("[voice] Could not subscribe to Android app lifecycle changes.", error);
      });
    return () => {
      active = false;
      void listener?.remove();
    };
  }, [pauseForLifecycle]);

  useEffect(
    () => () => {
      enabledRef.current = false;
      pipelineRef.current?.stop();
    },
    [],
  );

  const legacyStatus = asLegacyStatus(state, supported);
  const value: WakeWordContextValue = {
    enabled: enabledRef.current || state === "requesting_permission",
    supported,
    wakeWordAvailable: false,
    status: legacyStatus,
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
    stop,
    stopListening,
    startTapToTalk,
    startVoiceConversation,
    pauseVoiceConversation,
    resumeVoiceConversation,
    endVoiceConversation,
    submitText,
    setCommandHandler,
    retryLast,
    loadConversation,
    startNewConversation,
    stopSpeaking,
    setVoiceOutputEnabled,
    clearMessages,
  };

  return <WakeWordContext.Provider value={value}>{children}</WakeWordContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- custom hook is intentionally exported alongside the provider
export function useWakeWord() {
  const context = useContext(WakeWordContext);
  if (!context) throw new Error("useWakeWord must be used within WakeWordProvider");
  return context;
}
