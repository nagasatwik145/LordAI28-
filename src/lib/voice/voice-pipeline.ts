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
  "command_listening" | "processing" | "speaking" | "wake_listening" | "review" | "error";

export interface VoiceMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
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

export class VoicePipeline {
  private recognition: SpeechRecognitionLike | null = null;
  private abortController: AbortController | null = null;
  private processing = false;
  private messages: VoiceMessage[] = [];
  private conversationId: string | null = null;
  private mode: LordMode;
  private autoSpeak: boolean;
  private voiceRate: number;
  private interimTranscript = "";
  private failedUserMessage: VoiceMessage | null = null;
  private failedUserSaved = false;
  private speechStoppedByUser = false;
  private speaking = false;
  private cancelled = false;

  onStatusChange: (status: VoicePipelineStatus) => void = () => {};
  onTranscript: (text: string) => void = () => {};
  onResponse: (text: string) => void = () => {};
  onError: (error: string) => void = () => {};
  onMessagesChange: (messages: VoiceMessage[]) => void = () => {};
  onConversationChange: (conversationId: string | null) => void = () => {};
  onCommand: ((text: string) => boolean) | null = null;

  constructor(mode: LordMode = "balanced", autoSpeak = true, voiceRate = 1) {
    this.mode = mode;
    this.autoSpeak = autoSpeak;
    this.voiceRate = voiceRate;
  }

  setVoiceOutput(enabled: boolean) {
    this.autoSpeak = enabled;
    if (!enabled) this.stopSpeaking();
  }

  startListening() {
    if (this.processing) return false;
    if (this.recognition) return false;
    this.cancelled = false;
    this.stopSpeaking();
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      this.onError(
        "Speech recognition is not supported in this browser. Use the text command box.",
      );
      this.onStatusChange("error");
      return false;
    }

    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    let finalHandled = false;
    this.interimTranscript = "";
    recognition.onresult = (event) => {
      if (this.recognition !== recognition || finalHandled) return;
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      this.interimTranscript = transcript;
      if (transcript) this.onTranscript(transcript);
      const finalTranscript = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (finalTranscript && !finalHandled) {
        finalHandled = true;
        this.stopListening();
        if (this.onCommand?.(finalTranscript)) {
          this.onStatusChange("review");
          return;
        }
        void this.processSpeech(finalTranscript);
      }
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition) return;
      if (event.error === "aborted") return;
      if (event.error === "no-speech") {
        this.onStatusChange("wake_listening");
        return;
      }
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
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.recognition = null;
      if (!finalHandled && !this.processing) this.onStatusChange("wake_listening");
    };
    this.recognition = recognition;
    try {
      recognition.start();
      this.onStatusChange("command_listening");
      return true;
    } catch {
      this.recognition = null;
      this.onError("Speech recognition could not start. Use the text command box or retry.");
      this.onStatusChange("error");
      return false;
    }
  }

  async submitText(text: string) {
    if (this.onCommand?.(text)) {
      this.onTranscript(text.trim());
      this.onStatusChange("review");
      return;
    }
    await this.processSpeech(text);
  }

  async retryLast() {
    if (!this.failedUserMessage || this.processing) return;
    await this.processSpeech(this.failedUserMessage.text, true);
  }

  private async ensureConversation(firstText: string): Promise<{ id: string; userId: string }> {
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) throw new Error("Sign in to save and send voice conversations.");
    if (this.conversationId) return { id: this.conversationId, userId: data.user.id };

    const { data: conversation, error } = await supabase
      .from("conversations")
      .insert({
        user_id: data.user.id,
        title: firstText.slice(0, 60) || "Voice conversation",
        metadata: { source: "voice" },
      })
      .select("id")
      .single();
    if (error) throw error;
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
    this.messages = [];
    this.onConversationChange(null);
    this.onMessagesChange([]);
    this.onResponse("");
    this.onTranscript("");
  }

  private async processSpeech(rawText: string, retry = false) {
    const text = rawText.trim();
    if (!text || this.processing) return;
    this.cancelled = false;
    this.stopListening();
    this.processing = true;
    this.onStatusChange("processing");

    let userMessage = retry ? this.failedUserMessage : null;
    if (!userMessage) {
      userMessage = { id: crypto.randomUUID(), role: "user", text };
      this.failedUserMessage = userMessage;
      this.failedUserSaved = false;
      this.messages.push(userMessage);
      this.onMessagesChange([...this.messages]);
    }

    try {
      const { id: conversationId, userId } = await this.ensureConversation(text);
      if (!this.failedUserSaved) {
        const { error } = await supabase.from("messages").insert({
          id: userMessage.id,
          conversation_id: conversationId,
          user_id: userId,
          role: "user",
          content: userMessage.text,
          model: this.mode,
        });
        if (error) throw error;
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
      };
      const abortController = new AbortController();
      this.abortController = abortController;
      const response = await authenticatedFetch(`${getApiBaseUrl()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Lord-Voice-Mode": "true" },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });
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

      const answer = await streamTextLines(response, (partial) => this.onResponse(partial));
      if (!answer.trim()) throw new Error("LORD returned an empty response. Retry your command.");
      const assistantMessage: VoiceMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: answer,
      };
      this.messages.push(assistantMessage);
      this.onMessagesChange([...this.messages]);

      const { error: saveError } = await supabase.from("messages").insert({
        id: assistantMessage.id,
        conversation_id: conversationId,
        user_id: userId,
        role: "assistant",
        content: answer,
        model: this.mode,
      });
      if (saveError)
        throw new Error(`The response arrived but could not be saved: ${saveError.message}`);
      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);

      this.failedUserMessage = null;
      this.failedUserSaved = false;
      this.processing = false;
      if (this.autoSpeak && this.speak(answer)) this.onStatusChange("speaking");
      else this.onStatusChange("wake_listening");
    } catch (error) {
      this.processing = false;
      this.abortController = null;
      if (error instanceof Error && error.name === "AbortError") return;
      this.onError(
        error instanceof Error
          ? error.message
          : "The voice request failed. Your transcript is saved here for retry.",
      );
      this.onStatusChange("error");
    }
  }

  private speak(text: string): boolean {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return false;
    window.speechSynthesis.cancel();
    this.speechStoppedByUser = false;
    this.speaking = true;
    const chunks = splitSpeechText(text);
    let index = 0;
    const speakNext = () => {
      const part = chunks[index++]?.trim();
      if (!part) {
        this.speaking = false;
        this.onStatusChange("wake_listening");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.rate = this.voiceRate;
      utterance.onend = () => {
        if (this.cancelled) return;
        if (this.speechStoppedByUser) {
          this.speechStoppedByUser = false;
          this.speaking = false;
          return;
        }
        speakNext();
      };
      utterance.onerror = () => {
        if (this.cancelled) return;
        if (this.speechStoppedByUser) {
          this.speechStoppedByUser = false;
          this.speaking = false;
          this.onStatusChange("wake_listening");
          return;
        }
        this.speaking = false;
        this.onError("Speech playback stopped. The text response is still available.");
        this.onStatusChange("wake_listening");
      };
      window.speechSynthesis.speak(utterance);
    };
    speakNext();
    return true;
  }

  stopListening() {
    const recognition = this.recognition;
    this.recognition = null;
    try {
      recognition?.abort();
    } catch {
      // Recognition may already have ended.
    }
  }

  stopSpeaking() {
    if (this.speaking && typeof window !== "undefined" && "speechSynthesis" in window) {
      this.speechStoppedByUser = true;
      this.speaking = false;
      window.speechSynthesis.cancel();
      if (!this.recognition && !this.processing) this.onStatusChange("wake_listening");
    }
  }

  stop() {
    this.cancelled = true;
    this.stopListening();
    this.speechStoppedByUser = true;
    this.speaking = false;
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
