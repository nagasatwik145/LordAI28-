/**
 * Wake-engine interface.
 *
 * Wake engines should detect a short phrase independently of command speech
 * recognition. The current WebSpeech implementation is a foreground-only
 * compatibility engine that matches browser-recognized speech; it is not a
 * local acoustic wake-word model.
 */
export interface WakeEngine {
  readonly name: string;
  /** Load models / request mic. Resolves once ready to detect. */
  start(onWake: (phrase: string, command: string) => void): Promise<void>;
  /** Release mic + workers. Safe to call multiple times. */
  stop(): Promise<void>;
  /** Pause detection (e.g., while LORD is speaking) without releasing mic. */
  pause(): void;
  resume(): void;
}
