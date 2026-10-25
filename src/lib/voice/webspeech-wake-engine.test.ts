import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findWakePhrase,
  WebSpeechWakeEngine,
  type SpeechRecognitionLike,
} from "@/lib/voice/webspeech-wake-engine";

describe("findWakePhrase", () => {
  it.each(["Hey Lord", "hey, LORD", "HEY. Lord!", "Hey—Lord, open calendar"])(
    "recognizes punctuation and case variation in %s",
    (text) => {
      expect(findWakePhrase(text)).not.toBeNull();
    },
  );

  it("returns the command after the wake phrase without changing it", () => {
    expect(findWakePhrase("Hey, LORD, remind me tomorrow at 9am.")).toEqual({
      phrase: "Hey, LORD",
      command: "remind me tomorrow at 9am.",
    });
  });

  it.each(["Lord", "Hey Jarvis", "Okay Lord", "Hey Lordy", "Hello Lord"])(
    "does not activate on unrelated speech: %s",
    (text) => {
      expect(findWakePhrase(text)).toBeNull();
    },
  );
});

describe("WebSpeechWakeEngine", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("activates only when the browser returns the wake phrase", async () => {
    const recognizers: FakeRecognition[] = [];
    class FakeRecognition implements SpeechRecognitionLike {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: SpeechRecognitionLike["onresult"] = null;
      onend: SpeechRecognitionLike["onend"] = null;
      onerror: SpeechRecognitionLike["onerror"] = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        recognizers.push(this);
      }
    }
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });

    const onWake = vi.fn();
    const engine = new WebSpeechWakeEngine();
    await engine.start(onWake);

    recognizers[0].onresult?.({
      results: [{ isFinal: false, 0: { transcript: "Hey Lord" } }],
    });
    expect(onWake).not.toHaveBeenCalled();

    recognizers[0].onresult?.({
      results: [
        { isFinal: true, 0: { transcript: "Hey, LORD" } },
        { isFinal: false, 0: { transcript: "what's next?" } },
      ],
    });
    expect(onWake).toHaveBeenCalledWith("Hey, LORD", "what's next?");
    await engine.stop();
  });

  it("stops after a bounded number of recognition restarts", async () => {
    vi.useFakeTimers();
    const recognizers: FakeRecognition[] = [];
    class FakeRecognition implements SpeechRecognitionLike {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: SpeechRecognitionLike["onresult"] = null;
      onend: SpeechRecognitionLike["onend"] = null;
      onerror: SpeechRecognitionLike["onerror"] = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        recognizers.push(this);
      }
    }
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });

    const interrupted = vi.fn();
    const engine = new WebSpeechWakeEngine();
    engine.onInterrupted = interrupted;
    await engine.start(vi.fn());
    for (let restart = 0; restart < 5; restart++) {
      recognizers[recognizers.length - 1].onend?.();
      await vi.runOnlyPendingTimersAsync();
    }
    expect(interrupted).toHaveBeenCalledOnce();
    await engine.stop();
  });

  it("ignores an end callback from a session stopped before a new start", async () => {
    vi.useFakeTimers();
    const recognizers: FakeRecognition[] = [];
    class FakeRecognition implements SpeechRecognitionLike {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: SpeechRecognitionLike["onresult"] = null;
      onend: SpeechRecognitionLike["onend"] = null;
      onerror: SpeechRecognitionLike["onerror"] = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      constructor() {
        recognizers.push(this);
      }
    }
    vi.stubGlobal("window", { SpeechRecognition: FakeRecognition });

    const engine = new WebSpeechWakeEngine();
    await engine.start(vi.fn());
    const oldRecognition = recognizers[0];
    await engine.stop();
    await engine.start(vi.fn());
    oldRecognition.onend?.();
    await vi.runOnlyPendingTimersAsync();

    expect(recognizers).toHaveLength(2);
    expect(recognizers[1].start).toHaveBeenCalledOnce();
    await engine.stop();
  });
});

type FakeRecognition = SpeechRecognitionLike & {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
};
