import type { WakeEngine } from "./wake-engine";

export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<SpeechResultLike> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

const WAKE_PHRASE = /\bhey[\s,!.?;:\u2014\u2013-]+lord\b/i;

export function findWakePhrase(transcript: string): { phrase: string; command: string } | null {
  const match = WAKE_PHRASE.exec(transcript);
  if (!match || match.index === undefined) return null;
  return {
    phrase: match[0],
    command: transcript
      .slice(match.index + match[0].length)
      .replace(/^[\s,!.?;:\u2014\u2013-]+/, "")
      .trim(),
  };
}

/** Exact browser speech recognition for “Hey, LORD”; it never substitutes another wake model. */
export class WebSpeechWakeEngine implements WakeEngine {
  readonly name = "webspeech";
  onInterim: (transcript: string) => void = () => {};
  onError: (message: string) => void = () => {};
  onInterrupted: () => void = () => {};

  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private paused = false;
  private restartTimes: number[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private onWake: ((phrase: string, command: string) => void) | null = null;

  async start(onWake: (phrase: string, command: string) => void): Promise<void> {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) throw new Error("This browser does not support speech recognition.");
    await this.stop();
    this.onWake = onWake;
    this.active = true;
    this.startRecognition(Recognition);
  }

  private startRecognition(Recognition: SpeechRecognitionConstructor) {
    if (!this.active) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      if (!this.active || this.paused) return;
      const results = Array.from(event.results);
      const transcript = results
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (!transcript) return;
      this.onInterim(transcript);
      // Interim hypotheses often contain only “Hey, LORD” before the speaker
      // finishes the actual command. Keep that hypothesis visible, but wait
      // for finalized speech before switching recognition sessions.
      const finalizedTranscript = results
        .filter((result) => result.isFinal)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (!finalizedTranscript) return;
      if (!findWakePhrase(finalizedTranscript)) return;
      // Preserve any command words already present in the browser's current
      // interim hypothesis after the finalized wake phrase.
      const detected = findWakePhrase(transcript) ?? findWakePhrase(finalizedTranscript);
      if (!detected) return;
      this.active = false;
      this.onWake?.(detected.phrase, detected.command);
      recognition.stop();
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition) return;
      const code = event.error ?? "unknown";
      if (code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        this.active = false;
        this.onError("Microphone permission was denied. Allow microphone access and try again.");
        return;
      }
      if (code !== "no-speech") this.onError(`Speech recognition was interrupted (${code}).`);
    };
    recognition.onend = () => {
      // An aborted session can dispatch `end` after stop() and a subsequent
      // start(). Ignore that stale callback so it cannot create a second
      // recognition session beside the current one.
      if (this.recognition !== recognition) return;
      this.recognition = null;
      if (!this.active) return;
      if (this.restartTimer) clearTimeout(this.restartTimer);

      const now = Date.now();
      this.restartTimes = this.restartTimes.filter((time) => now - time < 60_000);
      if (this.restartTimes.length >= 4) {
        this.active = false;
        this.onInterrupted();
        return;
      }
      this.restartTimes.push(now);
      this.restartTimer = setTimeout(
        () => {
          if (this.active) this.startRecognition(Recognition);
        },
        Math.min(1_000 * this.restartTimes.length, 4_000),
      );
    };

    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      this.active = false;
      this.onError("Speech recognition could not start. Try tap-to-talk instead.");
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async stop(): Promise<void> {
    this.active = false;
    this.paused = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const recognition = this.recognition;
    this.recognition = null;
    try {
      recognition?.abort();
    } catch {
      // The browser may already have ended recognition.
    }
  }
}
