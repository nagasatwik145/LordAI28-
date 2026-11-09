import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { getApiBaseUrl } from "@/lib/api-config";
import { supabase } from "@/integrations/supabase/client";
import { streamTextLines } from "@/lib/stream-text-lines";
import type { LordMode } from "@/lib/modes";
import {
  getSpeechRecognitionConstructor,
  type SpeechRecognitionLike,
} from "./webspeech-wake-engine";

export type VoicePipelineStatus =
  | "requesting_permission"
  | "command_listening"
  | "processing"
  | "speaking"
  | "wake_listening"
  | "paused"
  | "review"
  | "error";

export interface VoiceMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export type VoiceControlCommand =
  "pause" | "resume" | "repeat" | "slower" | "stop-speaking" | "end";

function parseVoiceControlCommand(transcript: string): VoiceControlCommand | null {
  const normalized = transcript
    .trim()
    .toLocaleLowerCase()
    .replace(/^hey[\s,!.?;:\u2014\u2013-]+lord[\s,!.?;:\u2014\u2013-]*/, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
  switch (normalized) {
    case "pause listening":
      return "pause";
    case "resume listening":
      return "resume";
    case "repeat that":
      return "repeat";
    case "speak slower":
      return "slower";
    case "stop speaking":
      return "stop-speaking";
    case "bye lord":
    case "stop voice":
    case "turn off voice":
      return "end";
    default:
      return null;
  }
}

function splitSpeechText(text: string, maxLength = 1200): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  return sentences.flatMap((sentence) => {
    const chunks: string[] = [];
    let remaining = sentence.trim();
    while (remaining.length > maxLength) {
      const splitAt = remaining.lastIndexOf(" ", maxLength);
      const boundary = splitAt > maxLength * 0.6 ? splitAt : maxLength;
      chunks.push(remaining.slice(0, boundary).trim());
      remaining = remaining.slice(boundary).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  });
}

type VoiceFailureStage =
  "conversation" | "user_message" | "chat_request" | "response" | "assistant_message";

export function isMissingColumnError(error: unknown, columnName: string): boolean {
  const value = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const code = typeof value?.code === "string" ? value.code : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof value?.message === "string"
        ? value.message
        : "";
  const normalizedMessage = message.toLowerCase();
  if (code === "42703") return true;
  const columnMatches =
    normalizedMessage.includes(`.${columnName}`) ||
    normalizedMessage.includes(`"${columnName}"`) ||
    normalizedMessage.includes(` ${columnName}`) ||
    normalizedMessage.includes(`${columnName}`);
  return columnMatches && /does not exist|missing column/i.test(message);
}

function describeFailure(error: unknown, stage: VoiceFailureStage): string {
  const value = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const code = typeof value?.code === "string" ? value.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof value?.message === "string"
        ? value.message
        : "";
  const stageText: Record<VoiceFailureStage, string> = {
    conversation: "Could not create a voice conversation.",
    user_message: "Could not save your voice command.",
    chat_request: "Could not reach LORD's chat service.",
    response: "LORD could not complete the response.",
    assistant_message: "LORD replied, but the response could not be saved.",
  };
  const safeCode = code && /^[A-Z0-9_-]{2,20}$/i.test(code) ? ` (${code})` : "";
  if (stage === "chat_request" && /failed to fetch|networkerror/i.test(message)) {
    return "Could not reach LORD's chat service. Check your connection and try again.";
  }
  if (stage === "conversation" || stage === "user_message" || stage === "assistant_message") {
    if (code === "42501")
      return "LORD could not save this conversation because database access was denied. Sign in again, then retry.";
    if (code === "23505")
      return "This voice message was already saved. Retry the command to continue.";
    return `${stageText[stage]}${safeCode} Check your connection and retry.`;
  }
  if (message && error instanceof Error) return message;
  return `${stageText[stage]}${safeCode} Retry your command.`;
}

function logVoiceEvent(event: string, details: Record<string, unknown> = {}) {
  console.info(JSON.stringify({ event: `voice_${event}`, ...details }));
}

export class VoicePipeline {
  private recognition: SpeechRecognitionLike | null = null;
  private continuousSession = false;
  private sessionPaused = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private abortController: AbortController | null = null;
  private processing = false;
  private messages: VoiceMessage[] = [];
  private conversationId: string | null = null;
  private mode: LordMode;
  private pageContext = "LORD AI";
  private autoSpeak: boolean;
  private voiceRate: number;
  private voiceId: string | null;
  private interimTranscript = "";
  private failedUserMessage: VoiceMessage | null = null;
  private failedUserSaved = false;
  private speechStoppedByUser = false;
  private speaking = false;
  private activeAudio: HTMLAudioElement | null = null;
  private activeAudioUrl: string | null = null;
  private ttsAbortController: AbortController | null = null;
  private cancelled = false;
  private requestGeneration = 0;
  private speechGeneration = 0;
  private pendingAssistantSave: {
    message: VoiceMessage;
    conversationId: string;
    userId: string;
  } | null = null;

  onStatusChange: (status: VoicePipelineStatus) => void = () => {};
  onTranscript: (text: string) => void = () => {};
  onResponse: (text: string) => void = () => {};
  onError: (error: string) => void = () => {};
  onMessagesChange: (messages: VoiceMessage[]) => void = () => {};
  onConversationChange: (conversationId: string | null) => void = () => {};
  onCommand: ((text: string) => boolean) | null = null;
  onControlCommand: ((command: VoiceControlCommand) => void) | null = null;

  setPageContext(page: string) {
    this.pageContext = page.slice(0, 120);
  }

  repeatLastResponse() {
    const answer = [...this.messages].reverse().find((message) => message.role === "assistant");
    if (!answer) return false;
    void this.speak(answer.text).then((started) => {
      if (started) this.onStatusChange("speaking");
    });
    return true;
  }

  speakSlower() {
    this.voiceRate = Math.max(0.65, Math.round((this.voiceRate - 0.15) * 100) / 100);
    return this.voiceRate;
  }

  constructor(
    mode: LordMode = "balanced",
    autoSpeak = true,
    voiceRate = 1,
    voiceId: string | null = null,
  ) {
    this.mode = mode;
    this.autoSpeak = autoSpeak;
    this.voiceRate = voiceRate;
    this.voiceId = voiceId;
  }

  setVoiceId(voiceId: string | null) {
    this.voiceId = voiceId;
  }

  setVoiceOutput(enabled: boolean) {
    this.autoSpeak = enabled;
    if (!enabled) this.stopSpeaking();
  }

  startConversation() {
    this.sessionPaused = false;
    this.continuousSession = true;
    this.restartAttempts = 0;
    return this.startListening();
  }

  pauseConversation() {
    this.continuousSession = false;
    this.sessionPaused = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.stopListening();
    this.stopSpeaking();
    this.onStatusChange("paused");
  }

  resumeConversation() {
    this.sessionPaused = false;
    this.continuousSession = true;
    this.restartAttempts = 0;
    if (this.processing || this.speaking) return true;
    return this.startListening();
  }

  private resumeAfterTurn() {
    if (!this.continuousSession || this.cancelled || this.processing || this.speaking) return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.onStatusChange("wake_listening");
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.continuousSession || this.cancelled) return;
      if (!this.startListening()) this.scheduleRecognitionRetry();
    }, 250);
  }

  private scheduleRecognitionRetry() {
    if (!this.continuousSession || this.cancelled || this.restartTimer) return;
    if (this.restartAttempts >= 3) {
      this.continuousSession = false;
      this.onError("Speech recognition stopped repeatedly. Restart voice or use text chat.");
      this.onStatusChange("error");
      return;
    }
    const delay = 400 * 2 ** this.restartAttempts++;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.continuousSession && !this.cancelled && !this.processing) {
        if (!this.startListening()) this.scheduleRecognitionRetry();
      }
    }, delay);
  }

  startListening() {
    if (this.processing) return false;
    if (this.recognition) return false;
    this.cancelled = false;
    this.stopSpeaking();
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      this.continuousSession = false;
      logVoiceEvent("recognition_unavailable");
      this.onError(
        "Speech recognition is not supported in this browser. Use the text command box.",
      );
      this.onStatusChange("error");
      return false;
    }

    const recognition = new Recognition();
    logVoiceEvent("recognition_initialized", { browserApi: "Web Speech API" });
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    let finalHandled = false;
    this.interimTranscript = "";
    recognition.onstart = () => {
      if (this.recognition === recognition) this.onStatusChange("command_listening");
    };
    recognition.onresult = (event) => {
      if (this.recognition !== recognition || finalHandled) return;
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      this.interimTranscript = transcript;
      if (transcript) {
        this.restartAttempts = 0;
        this.onTranscript(transcript);
      }
      const finalTranscript = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (finalTranscript && !finalHandled) {
        finalHandled = true;
        logVoiceEvent("transcript_captured", { characters: finalTranscript.length });
        this.stopListening();
        if (finalTranscript.trim().length < 2) {
          this.onTranscript("");
          this.resumeAfterTurn();
          return;
        }
        const controlCommand = parseVoiceControlCommand(finalTranscript);
        if (controlCommand) {
          this.onControlCommand?.(controlCommand);
          return;
        }
        if (this.onCommand?.(finalTranscript)) {
          this.onStatusChange("review");
          return;
        }
        void this.processSpeech(finalTranscript);
      } else if (Array.from(event.results).some((result) => result.isFinal) && !finalHandled) {
        finalHandled = true;
        this.stopListening();
        if (this.continuousSession) {
          this.onTranscript("");
          this.resumeAfterTurn();
        } else {
          this.onError(
            "I couldn't make out any words. Tap to talk and try again, or type your command.",
          );
          this.onStatusChange("error");
        }
      }
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition) return;
      if (event.error === "aborted") return;
      logVoiceEvent("recognition_error", { code: event.error ?? "unknown" });
      if (event.error === "no-speech" || event.error === "network") {
        this.detachRecognition(recognition, true);
        if (this.continuousSession) {
          if (event.error === "network") {
            this.onError(
              "Speech recognition lost its connection to the speech service. Reconnecting…",
            );
          }
          this.onStatusChange("wake_listening");
          this.scheduleRecognitionRetry();
        } else {
          this.onError(
            event.error === "network"
              ? "Speech recognition could not reach its speech service. Check your connection and retry, or use text chat."
              : "I didn't hear any speech. Tap to talk and try again, or type your command.",
          );
          this.continuousSession = false;
          this.onStatusChange("error");
        }
        return;
      }
      this.detachRecognition(recognition, true);
      this.onError(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone permission was denied. Allow access and try again."
          : event.error === "network"
            ? "Speech recognition could not reach its speech service. Check your connection and retry, or use text chat."
            : event.error === "audio-capture"
              ? "No usable microphone was found. Check your microphone or use text chat."
              : `Speech recognition was interrupted (${event.error ?? "unknown error"}). Tap the microphone to retry.`,
      );
      this.onStatusChange("error");
      this.continuousSession = false;
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.detachRecognition(recognition);
      if (!finalHandled && !this.processing) {
        if (this.continuousSession) this.scheduleRecognitionRetry();
        else this.onStatusChange("wake_listening");
      }
    };
    this.recognition = recognition;
    try {
      this.onStatusChange("requesting_permission");
      recognition.start();
      logVoiceEvent("recognition_started");
      return true;
    } catch (error) {
      logVoiceEvent("recognition_start_failed");
      this.recognition = null;
      this.continuousSession = false;
      this.onError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access, then retry voice."
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "No microphone is available. Connect one or use text chat."
            : "Speech recognition could not start. Use the text command box or retry.",
      );
      this.onStatusChange("error");
      return false;
    }
  }

  async submitText(text: string) {
    const controlCommand = parseVoiceControlCommand(text);
    if (controlCommand) {
      this.onControlCommand?.(controlCommand);
      return;
    }
    if (this.onCommand?.(text)) {
      this.onTranscript(text.trim());
      this.onStatusChange("review");
      return;
    }
    await this.processSpeech(text);
  }

  async retryLast() {
    if (!this.failedUserMessage || this.processing) return;
    if (this.pendingAssistantSave) {
      await this.retryAssistantSave();
      return;
    }
    await this.processSpeech(this.failedUserMessage.text, true);
  }

  private async retryAssistantSave() {
    const pending = this.pendingAssistantSave;
    if (!pending || this.processing) return;
    this.processing = true;
    this.onStatusChange("processing");
    try {
      const { error } = await supabase.from("messages").insert({
        id: pending.message.id,
        conversation_id: pending.conversationId,
        user_id: pending.userId,
        role: "assistant",
        content: pending.message.text,
        model: this.mode,
      });
      if (error) throw new Error(describeFailure(error, "assistant_message"), { cause: error });
      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", pending.conversationId);
      this.pendingAssistantSave = null;
      this.failedUserMessage = null;
      this.failedUserSaved = false;
      this.onStatusChange("wake_listening");
    } catch (error) {
      this.onError(
        error instanceof Error ? error.message : describeFailure(error, "assistant_message"),
      );
      this.onStatusChange("error");
    } finally {
      this.processing = false;
    }
  }

  private async ensureConversation(firstText: string): Promise<{ id: string; userId: string }> {
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) throw new Error("Sign in to save and send voice conversations.");
    if (this.conversationId) return { id: this.conversationId, userId: data.user.id };

    const title = firstText.slice(0, 60) || "Voice conversation";
    const primaryInsert = {
      user_id: data.user.id,
      title,
      metadata: { source: "voice" },
    };
    const { data: conversation, error } = await supabase
      .from("conversations")
      .insert(primaryInsert)
      .select("id")
      .single();
    if (error && !isMissingColumnError(error, "metadata")) throw error;
    if (error) {
      const fallback = await supabase
        .from("conversations")
        .insert({ user_id: data.user.id, title })
        .select("id")
        .single();
      if (fallback.error) throw fallback.error;
      this.conversationId = fallback.data.id;
      this.onConversationChange(fallback.data.id);
      return { id: fallback.data.id, userId: data.user.id };
    }
    this.conversationId = conversation.id;
    this.onConversationChange(conversation.id);
    return { id: conversation.id, userId: data.user.id };
  }

  async loadConversation(conversationId: string) {
    this.stop();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) throw new Error("Sign in to view saved voice conversations.");

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) throw new Error("That voice conversation is unavailable.");

    const { data: rows, error } = await supabase
      .from("messages")
      .select("id, role, content")
      .eq("conversation_id", conversationId)
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    this.conversationId = conversationId;
    this.failedUserMessage = null;
    this.failedUserSaved = false;
    this.pendingAssistantSave = null;
    this.messages = (rows ?? [])
      .filter(
        (row): row is typeof row & { role: "user" | "assistant" } =>
          row.role === "user" || row.role === "assistant",
      )
      .map((row) => ({ id: row.id, role: row.role, text: row.content ?? "" }));
    this.onConversationChange(conversationId);
    this.onMessagesChange([...this.messages]);
    this.onResponse("");
    this.onTranscript("");
  }

  startNewConversation() {
    this.stop();
    this.conversationId = null;
    this.failedUserMessage = null;
    this.failedUserSaved = false;
    this.pendingAssistantSave = null;
    this.messages = [];
    this.onConversationChange(null);
    this.onMessagesChange([]);
    this.onResponse("");
    this.onTranscript("");
  }

  private async processSpeech(rawText: string, retry = false) {
    const text = rawText.trim();
    if (!text || this.processing) return;
    let failureStage: VoiceFailureStage = "conversation";
    this.cancelled = false;
    const generation = ++this.requestGeneration;
    this.stopListening();
    this.processing = true;
    this.onStatusChange("processing");
    logVoiceEvent("request_started", { retry, messageCount: this.messages.length });

    let userMessage = retry ? this.failedUserMessage : null;
    if (!userMessage) {
      userMessage = { id: crypto.randomUUID(), role: "user", text };
      this.failedUserMessage = userMessage;
      this.failedUserSaved = false;
      this.messages.push(userMessage);
      this.onMessagesChange([...this.messages]);
    }

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error("Could not verify your sign-in. Please retry.");
      let authenticatedUser: { id: string } | null = null;
      if (sessionData.session) {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw new Error("Could not verify your sign-in. Please retry.");
        authenticatedUser = authData.user;
      }
      const conversation = authenticatedUser ? await this.ensureConversation(text) : null;
      const conversationId = conversation?.id ?? null;
      const userId = conversation?.userId ?? null;
      if (generation !== this.requestGeneration) return;
      if (authenticatedUser && conversationId && userId && !this.failedUserSaved) {
        const { error } = await supabase.from("messages").insert({
          id: userMessage.id,
          conversation_id: conversationId,
          user_id: userId,
          role: "user",
          content: userMessage.text,
          model: this.mode,
        });
        if (generation !== this.requestGeneration) return;
        if (error)
          throw Object.assign(new Error(describeFailure(error, "user_message")), {
            cause: error,
            voiceStage: "user_message",
          });
        this.failedUserSaved = true;
        await supabase
          .from("conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conversationId);
      }

      const body = {
        messages: this.messages.map((message) => ({
          id: message.id,
          role: message.role,
          parts: [{ type: "text", text: message.text }],
        })),
        mode: this.mode,
        context: { page: this.pageContext, responseStyle: "concise" as const },
      };
      const abortController = new AbortController();
      this.abortController = abortController;
      failureStage = "chat_request";
      logVoiceEvent("api_request_started", {
        endpoint: "/api/chat",
        messageCount: body.messages.length,
      });
      let response: Response;
      try {
        response = await authenticatedFetch(`${getApiBaseUrl()}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Lord-Voice-Mode": "true" },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });
      } catch (error) {
        throw new Error(describeFailure(error, "chat_request"), { cause: error });
      }
      if (generation !== this.requestGeneration) return;
      logVoiceEvent("api_response", { status: response.status, ok: response.ok });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
          message?: string;
        } | null;
        throw new Error(
          payload?.error?.message ??
            payload?.message ??
            `Chat request failed (${response.status}).`,
        );
      }

      failureStage = "response";
      const answer = await streamTextLines(response, (partial) => this.onResponse(partial));
      if (generation !== this.requestGeneration) return;
      this.abortController = null;
      if (!answer.trim()) throw new Error("LORD returned an empty response. Retry your command.");
      logVoiceEvent("response_completed", { characters: answer.length });
      const assistantMessage: VoiceMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: answer,
      };
      this.messages.push(assistantMessage);
      this.onMessagesChange([...this.messages]);

      if (conversationId && userId) {
        const { error: saveError } = await supabase.from("messages").insert({
          id: assistantMessage.id,
          conversation_id: conversationId,
          user_id: userId,
          role: "assistant",
          content: answer,
          model: this.mode,
        });
        if (generation !== this.requestGeneration) return;
        if (saveError) {
          failureStage = "assistant_message";
          this.pendingAssistantSave = { message: assistantMessage, conversationId, userId };
          throw Object.assign(new Error(describeFailure(saveError, "assistant_message")), {
            cause: saveError,
            voiceStage: "assistant_message",
          });
        }
        await supabase
          .from("conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conversationId);
      }

      this.failedUserMessage = null;
      this.failedUserSaved = false;
      this.pendingAssistantSave = null;
      this.processing = false;
      if (this.sessionPaused) {
        this.onStatusChange("paused");
        return;
      }
      const startedPlayback = this.autoSpeak ? await this.speak(answer) : false;
      if (generation !== this.requestGeneration) return;
      if (startedPlayback) this.onStatusChange("speaking");
      else this.resumeAfterTurn();
    } catch (error) {
      if (generation !== this.requestGeneration) return;
      this.processing = false;
      this.abortController = null;
      if (error instanceof Error && error.name === "AbortError") return;
      const markedStage =
        error && typeof error === "object" && "voiceStage" in error
          ? (error as { voiceStage?: VoiceFailureStage }).voiceStage
          : undefined;
      const message = error instanceof Error ? error.message : describeFailure(error, failureStage);
      const cause = error instanceof Error ? error.cause : error;
      const errorCode =
        cause && typeof cause === "object" && "code" in cause
          ? String((cause as { code?: unknown }).code ?? "")
          : undefined;
      logVoiceEvent("request_failed", {
        stage: markedStage ?? failureStage,
        errorType: error instanceof Error ? "Error" : "structured",
        code: errorCode,
      });
      this.onError(message);
      this.onStatusChange("error");
      this.resumeAfterTurn();
    }
  }

  private async speak(text: string): Promise<boolean> {
    if (typeof window === "undefined" || !text) return false;
    const playbackGeneration = this.speechGeneration;
    const controller = new AbortController();
    this.ttsAbortController = controller;
    try {
      const response = await authenticatedFetch(`${getApiBaseUrl()}/api/voice/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, speed: this.voiceRate, voiceId: this.voiceId }),
        signal: controller.signal,
      });
      if (playbackGeneration !== this.speechGeneration) return false;
      if (response.ok) {
        const audioBlob = await response.blob();
        if (playbackGeneration !== this.speechGeneration) return false;
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        this.activeAudio = audio;
        this.activeAudioUrl = audioUrl;
        audio.preload = "auto";
        audio.onended = () => {
          if (this.activeAudio !== audio) return;
          this.activeAudio = null;
          if (this.activeAudioUrl) URL.revokeObjectURL(this.activeAudioUrl);
          this.activeAudioUrl = null;
          this.speaking = false;
          this.resumeAfterTurn();
        };
        audio.onerror = () => {
          if (this.activeAudio !== audio) return;
          this.activeAudio = null;
          if (this.activeAudioUrl) URL.revokeObjectURL(this.activeAudioUrl);
          this.activeAudioUrl = null;
          this.speaking = false;
          logVoiceEvent("tts_playback_failed");
          this.onError("Speech playback stopped. The text response is still available.");
          this.resumeAfterTurn();
        };
        await audio.play();
        this.speaking = true;
        logVoiceEvent("tts_playback_started", { provider: "fish-audio" });
        return true;
      }
      logVoiceEvent("tts_unavailable", { status: response.status });
    } catch {
      if (playbackGeneration !== this.speechGeneration) return false;
      logVoiceEvent("tts_unavailable");
    } finally {
      if (this.ttsAbortController === controller) this.ttsAbortController = null;
    }
    if (!("speechSynthesis" in window)) {
      this.onError("Spoken replies are unavailable here. LORD's text response is still available.");
      return false;
    }
    try {
      const speechGeneration = ++this.speechGeneration;
      window.speechSynthesis.cancel();
      this.speechStoppedByUser = false;
      this.speaking = true;
      const chunks = splitSpeechText(text);
      let index = 0;
      const speakNext = () => {
        const part = chunks[index++]?.trim();
        if (!part) {
          this.speaking = false;
          this.resumeAfterTurn();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(part);
        utterance.rate = this.voiceRate;
        utterance.onstart = () =>
          logVoiceEvent("tts_playback_started", { chunk: index, chunks: chunks.length });
        utterance.onend = () => {
          if (this.cancelled || speechGeneration !== this.speechGeneration) return;
          logVoiceEvent("tts_chunk_completed", { chunk: index, chunks: chunks.length });
          if (this.speechStoppedByUser) {
            this.speechStoppedByUser = false;
            this.speaking = false;
            return;
          }
          speakNext();
        };
        utterance.onerror = () => {
          if (this.cancelled || speechGeneration !== this.speechGeneration) return;
          if (this.speechStoppedByUser) {
            this.speechStoppedByUser = false;
            this.speaking = false;
            this.resumeAfterTurn();
            return;
          }
          this.speaking = false;
          logVoiceEvent("tts_playback_failed");
          this.onError("Speech playback stopped. The text response is still available.");
          this.resumeAfterTurn();
        };
        window.speechSynthesis.speak(utterance);
      };
      speakNext();
      return true;
    } catch {
      this.speaking = false;
      logVoiceEvent("tts_playback_failed", { reason: "synchronous_error" });
      this.onError("Spoken replies could not start. LORD's text response is still available.");
      return false;
    }
  }

  stopListening() {
    const recognition = this.recognition;
    if (recognition) this.detachRecognition(recognition, true);
  }

  private detachRecognition(recognition: SpeechRecognitionLike, abort = false) {
    if (this.recognition === recognition) this.recognition = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
    try {
      if (abort) recognition.abort();
    } catch {
      // Recognition may already have ended.
    }
  }

  stopSpeaking() {
    this.speechGeneration += 1;
    this.ttsAbortController?.abort();
    this.ttsAbortController = null;
    const audio = this.activeAudio;
    this.activeAudio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      this.speaking = false;
      if (this.activeAudioUrl) URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = null;
      this.resumeAfterTurn();
    }
    if (this.speaking && typeof window !== "undefined" && "speechSynthesis" in window) {
      this.speechStoppedByUser = true;
      this.speaking = false;
      window.speechSynthesis.cancel();
      if (!this.recognition && !this.processing) this.resumeAfterTurn();
    }
  }

  stop() {
    this.continuousSession = false;
    this.sessionPaused = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.cancelled = true;
    this.requestGeneration += 1;
    this.speechGeneration += 1;
    this.ttsAbortController?.abort();
    this.ttsAbortController = null;
    this.stopListening();
    this.speechStoppedByUser = true;
    this.speaking = false;
    const audio = this.activeAudio;
    this.activeAudio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      if (this.activeAudioUrl) URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.abortController?.abort();
    this.abortController = null;
    this.processing = false;
  }

  clearMessages() {
    this.startNewConversation();
  }

  getMessages(): VoiceMessage[] {
    return [...this.messages];
  }
}
