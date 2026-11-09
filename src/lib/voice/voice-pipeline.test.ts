import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/authenticated-fetch", () => ({ authenticatedFetch: mocks.authenticatedFetch }));
vi.mock("@/lib/api-config", () => ({ getApiBaseUrl: () => "" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser, getSession: mocks.getSession }, from: mocks.from },
}));

import { VoicePipeline } from "./voice-pipeline";

const conversationId = "11111111-1111-4111-8111-111111111111";
const assistantStream = () =>
  new Response('data: {"type":"text-delta","delta":"Hello from LORD."}\n\n', {
    headers: { "Content-Type": "text/event-stream" },
  });

function setupDatabase() {
  const messageInsert = vi.fn().mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    if (table === "conversations") {
      return {
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: conversationId }, error: null }) }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    return { insert: messageInsert };
  });
  mocks.authenticatedFetch.mockImplementation(async () => assistantStream());
  return { messageInsert };
}

describe("VoicePipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts text to the shared authenticated /api/chat route and renders the response", async () => {
    const pipeline = new VoicePipeline("balanced", false);
    const onMessagesChange = vi.fn();
    pipeline.onMessagesChange = onMessagesChange;
    await pipeline.submitText("How are you?");

    expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({ method: "POST", headers: expect.any(Object) }),
    );
    const request = mocks.authenticatedFetch.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.messages.at(-1).parts[0].text).toBe("How are you?");
    expect(onMessagesChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", text: "Hello from LORD." }),
      ]),
    );
  });

  it("sends the selected voice and speed to the authenticated Fish Audio endpoint", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:voice-preview"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      "Audio",
      class {
        preload = "";
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        async play() {}
        pause() {}
      },
    );
    mocks.authenticatedFetch.mockResolvedValue(new Response(new Blob(["audio"]), { status: 200 }));
    const voiceId = "933563129e564b19a115bedd57b7406a";
    const pipeline = new VoicePipeline("balanced", true, 1.15, voiceId);

    await (pipeline as unknown as { speak: (text: string) => Promise<boolean> }).speak(
      "Voice selection test",
    );

    expect(mocks.authenticatedFetch).toHaveBeenCalledWith(
      "/api/voice/tts",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(mocks.authenticatedFetch.mock.calls[0][1].body)).toEqual({
      text: "Voice selection test",
      speed: 1.15,
      voiceId,
    });
  });

  it("handles exact voice controls locally, adds coarse page context, and leaves ordinary text alone", async () => {
    const pipeline = new VoicePipeline("balanced", false);
    const command = vi.fn();
    pipeline.onControlCommand = command;
    pipeline.setPageContext("LORD AI section: Study");

    await pipeline.submitText("Hey, LORD, pause listening!");
    expect(command).toHaveBeenCalledWith("pause");
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled();

    await pipeline.submitText("I might stop voice someday, but keep helping me.");
    const body = JSON.parse(mocks.authenticatedFetch.mock.calls[0][1].body);
    expect(body.context).toEqual({ page: "LORD AI section: Study", responseStyle: "concise" });
    expect(command).toHaveBeenCalledOnce();
  });

  it.each([
    ["Bye LORD", "end"],
    ["Stop voice.", "end"],
    ["Turn off voice!", "end"],
    ["Resume listening", "resume"],
    ["Repeat that", "repeat"],
    ["Speak slower", "slower"],
    ["Stop speaking", "stop-speaking"],
  ] as const)("recognizes the exact voice control %s", async (text, expected) => {
    const pipeline = new VoicePipeline("balanced", false);
    const command = vi.fn();
    pipeline.onControlCommand = command;
    await pipeline.submitText(text);
    expect(command).toHaveBeenCalledExactlyOnceWith(expected);
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled();
  });

  it("stores voice conversations with the voice metadata tag so history queries match the database", async () => {
    const pipeline = new VoicePipeline("balanced", false);
    const insertSpy = vi.fn().mockReturnValue({
      select: () => ({ single: async () => ({ data: { id: conversationId }, error: null }) }),
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "conversations") {
        return {
          insert: insertSpy,
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    });

    await pipeline.submitText("Say hello");

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        metadata: { source: "voice" },
      }),
    );
  });

  it("falls back when the metadata column has not been added to conversations yet", async () => {
    const pipeline = new VoicePipeline("balanced", false);
    const insertSpy = vi.fn((payload: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          if (payload.metadata) {
            return {
              data: null,
              error: {
                code: "42703",
                message: "column conversations.metadata does not exist",
              },
            };
          }
          return { data: { id: conversationId }, error: null };
        },
      }),
    }));
    mocks.from.mockImplementation((table: string) => {
      if (table === "conversations") {
        return {
          insert: insertSpy,
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    });

    await pipeline.submitText("Say hello");

    expect(insertSpy).toHaveBeenCalledTimes(2);
    expect(insertSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        user_id: "user-1",
        metadata: { source: "voice" },
      }),
    );
    expect(insertSpy.mock.calls[1][0]).toEqual({
      user_id: "user-1",
      title: "Say hello",
    });
  });

  it("allows guest voice requests without database writes when a guest cookie is present", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Auth session missing"),
    });
    vi.stubGlobal("document", { cookie: "lord_guest_session=test-session" });

    const pipeline = new VoicePipeline("balanced", false);
    await pipeline.submitText("Guest voice command");

    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(1);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(pipeline.getMessages()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", text: "Guest voice command" }),
        expect.objectContaining({ role: "assistant", text: "Hello from LORD." }),
      ]),
    );
  });

  it("preserves a failed transcript and retries the same saved user message", async () => {
    const { messageInsert } = setupDatabase();
    mocks.authenticatedFetch
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementationOnce(async () => assistantStream());
    const pipeline = new VoicePipeline("balanced", false);
    const onError = vi.fn();
    pipeline.onError = onError;

    await pipeline.submitText("Original command");
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining("Check your connection"));
    const originalId = pipeline.getMessages()[0].id;
    await pipeline.retryLast();

    expect(pipeline.getMessages().filter((message) => message.role === "user")).toHaveLength(1);
    expect(pipeline.getMessages()[0].id).toBe(originalId);
    expect(messageInsert).toHaveBeenCalledTimes(2);
    expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it("explains structured Supabase failures rather than hiding them as a generic voice error", async () => {
    mocks.from.mockImplementation((table: string) =>
      table === "conversations"
        ? {
            insert: () => ({
              select: () => ({ single: async () => ({ data: null, error: { code: "42501" } }) }),
            }),
          }
        : { insert: vi.fn() },
    );
    const pipeline = new VoicePipeline("balanced", false);
    const onError = vi.fn();
    pipeline.onError = onError;
    await pipeline.submitText("Can you help?");

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("database access was denied"));
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled();
  });

  it("handles multiple consecutive commands without carrying failed state forward", async () => {
    const pipeline = new VoicePipeline("balanced", false);
    await pipeline.submitText("First command");
    await pipeline.submitText("Second command");

    expect(
      pipeline
        .getMessages()
        .filter((message) => message.role === "user")
        .map((m) => m.text),
    ).toEqual(["First command", "Second command"]);
    expect(pipeline.getMessages().filter((message) => message.role === "assistant")).toHaveLength(
      2,
    );
  });

  it("starts one Chrome Web Speech recognition session and surfaces network/no-speech failures", () => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      onresult:
        | ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
        | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error?: string }) => void) | null = null;
    }
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    const pipeline = new VoicePipeline("balanced", false);
    const onError = vi.fn();
    pipeline.onError = onError;

    expect(pipeline.startListening()).toBe(true);
    expect(pipeline.startListening()).toBe(false);
    const recognition = (pipeline as unknown as { recognition: FakeRecognition }).recognition;
    recognition.onerror?.({ error: "network" });
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining("speech service"));
    pipeline.stop();
    expect(recognition.abort).toHaveBeenCalledOnce();

    const noSpeechPipeline = new VoicePipeline("balanced", false);
    const noSpeechError = vi.fn();
    noSpeechPipeline.onError = noSpeechError;
    noSpeechPipeline.startListening();
    const noSpeechRecognition = (noSpeechPipeline as unknown as { recognition: FakeRecognition })
      .recognition;
    noSpeechRecognition.onerror?.({ error: "no-speech" });
    expect(noSpeechError).toHaveBeenLastCalledWith(expect.stringContaining("didn't hear"));
    noSpeechPipeline.stop();
  });

  it("submits a finalized Chrome transcript and rejects an empty final transcript", async () => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      onresult:
        | ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
        | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error?: string }) => void) | null = null;
    }
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    const pipeline = new VoicePipeline("balanced", false);
    const onTranscript = vi.fn();
    pipeline.onTranscript = onTranscript;
    pipeline.startListening();
    const recognition = (pipeline as unknown as { recognition: FakeRecognition }).recognition;
    recognition.onresult?.({
      results: [{ isFinal: true, 0: { transcript: "Find my next meeting" } }],
    });
    await vi.waitFor(() => expect(mocks.authenticatedFetch).toHaveBeenCalledOnce());
    expect(onTranscript).toHaveBeenCalledWith("Find my next meeting");
    expect(
      JSON.parse(mocks.authenticatedFetch.mock.calls[0][1].body).messages[0].parts[0].text,
    ).toBe("Find my next meeting");

    const emptyPipeline = new VoicePipeline("balanced", false);
    const onError = vi.fn();
    emptyPipeline.onError = onError;
    emptyPipeline.startListening();
    const emptyRecognition = (emptyPipeline as unknown as { recognition: FakeRecognition })
      .recognition;
    emptyRecognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: "   " } }] });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("couldn't make out any words"));
    emptyPipeline.stop();
  });

  it("restarts listening after a completed turn only while the voice session remains active", async () => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      onresult:
        | ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
        | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error?: string }) => void) | null = null;
    }
    const instances: FakeRecognition[] = [];
    class RecordingRecognition extends FakeRecognition {
      constructor() {
        super();
        instances.push(this);
      }
    }
    vi.stubGlobal("window", { webkitSpeechRecognition: RecordingRecognition });
    const pipeline = new VoicePipeline("balanced", false);
    expect(pipeline.startConversation()).toBe(true);
    expect(pipeline.startConversation()).toBe(false);
    instances[0].onresult?.({
      results: [{ isFinal: true, 0: { transcript: "First hands free turn" } }],
    });
    await vi.waitFor(() => expect(mocks.authenticatedFetch).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(instances).toHaveLength(2);
    expect(instances[1].start).toHaveBeenCalledOnce();

    pipeline.pauseConversation();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(instances).toHaveLength(2);
    pipeline.stop();
  });

  it("bounds repeated speech-service failures instead of restarting forever", async () => {
    vi.useFakeTimers();
    try {
      const instances: Array<{
        start: ReturnType<typeof vi.fn>;
        abort: ReturnType<typeof vi.fn>;
        onerror: ((event: { error?: string }) => void) | null;
      }> = [];
      class FailingRecognition {
        continuous = false;
        interimResults = false;
        lang = "";
        onresult = null;
        onend = null;
        onerror: ((event: { error?: string }) => void) | null = null;
        start = vi.fn(() => setTimeout(() => this.onerror?.({ error: "network" }), 0));
        stop = vi.fn();
        abort = vi.fn();
        constructor() {
          instances.push(this);
        }
      }
      vi.stubGlobal("window", { webkitSpeechRecognition: FailingRecognition });
      const pipeline = new VoicePipeline("balanced", false);
      const onError = vi.fn();
      pipeline.onError = onError;
      expect(pipeline.startConversation()).toBe(true);

      await vi.runAllTimersAsync();
      expect(instances).toHaveLength(4);
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("stopped repeatedly"));
      pipeline.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a clear fallback when Chrome Web Speech recognition is unavailable", () => {
    vi.stubGlobal("window", {});
    const pipeline = new VoicePipeline("balanced", false);
    const onError = vi.fn();
    pipeline.onError = onError;

    expect(pipeline.startListening()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("not supported"));
  });

  it("waits for the recognition start event before reporting listening and handles spoken exit locally", () => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      onstart: (() => void) | null = null;
      onresult:
        | ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void)
        | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error?: string }) => void) | null = null;
    }
    vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
    const pipeline = new VoicePipeline("balanced", false);
    const states: string[] = [];
    const control = vi.fn();
    pipeline.onStatusChange = (state) => states.push(state);
    pipeline.onControlCommand = control;

    expect(pipeline.startConversation()).toBe(true);
    expect(states.at(-1)).toBe("requesting_permission");
    const recognition = (pipeline as unknown as { recognition: FakeRecognition }).recognition;
    recognition.onstart?.();
    expect(states.at(-1)).toBe("command_listening");
    recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: "Bye LORD" } }] });
    expect(control).toHaveBeenCalledExactlyOnceWith("end");
    expect(mocks.authenticatedFetch).not.toHaveBeenCalled();
    pipeline.stop();
  });

  it("reports successful and failed TTS playback without hiding the text response", async () => {
    class FakeAudio {
      static instances: FakeAudio[] = [];
      src = "";
      preload = "";
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onpause: (() => void) | null = null;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      currentTime = 0;

      constructor() {
        FakeAudio.instances.push(this);
      }
    }

    const createObjectURL = vi.fn(() => "blob:mock-audio");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("window", {
      Audio: FakeAudio,
      URL: { createObjectURL, revokeObjectURL },
    });
    vi.stubGlobal("Audio", FakeAudio);
    mocks.authenticatedFetch.mockImplementation(async (url: string | URL) => {
      const target = typeof url === "string" ? url : url.toString();
      if (target === "/api/chat") return assistantStream();
      return new Response(new Blob(["music"], { type: "audio/mpeg" }));
    });

    const pipeline = new VoicePipeline("balanced", true);
    const onError = vi.fn();
    pipeline.onError = onError;

    await pipeline.submitText("Speak this response");
    await vi.waitFor(() => expect(mocks.authenticatedFetch).toHaveBeenCalledTimes(2));
    const firstAudio = (pipeline as unknown as { activeAudio: FakeAudio | null }).activeAudio;
    expect(firstAudio).toBeTruthy();
    firstAudio!.onended?.();
    expect(pipeline.getMessages().some((message) => message.text === "Hello from LORD.")).toBe(
      true,
    );

    await pipeline.submitText("Speak another response");
    const secondAudio = (pipeline as unknown as { activeAudio: FakeAudio | null }).activeAudio;
    secondAudio!.onerror?.();
    expect(pipeline.getMessages().some((message) => message.text === "Hello from LORD.")).toBe(
      true,
    );
  });
});
