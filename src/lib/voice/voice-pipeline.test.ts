import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/authenticated-fetch", () => ({ authenticatedFetch: mocks.authenticatedFetch }));
vi.mock("@/lib/api-config", () => ({ getApiBaseUrl: () => "" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser }, from: mocks.from },
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

  it("offers a clear fallback when Chrome Web Speech recognition is unavailable", () => {
    vi.stubGlobal("window", {});
    const pipeline = new VoicePipeline("balanced", false);
    const onError = vi.fn();
    pipeline.onError = onError;

    expect(pipeline.startListening()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("not supported"));
  });

  it("reports successful and failed TTS playback without hiding the text response", async () => {
    class FakeUtterance {
      text: string;
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    const utterances: FakeUtterance[] = [];
    const speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn((utterance: FakeUtterance) => utterances.push(utterance)),
    };
    vi.stubGlobal("window", { speechSynthesis });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const pipeline = new VoicePipeline("balanced", true);
    const onError = vi.fn();
    pipeline.onError = onError;

    await pipeline.submitText("Speak this response");
    expect(utterances).toHaveLength(1);
    utterances[0].onend?.();
    expect(pipeline.getMessages().some((message) => message.text === "Hello from LORD.")).toBe(
      true,
    );

    await pipeline.submitText("Speak another response");
    utterances.at(-1)?.onerror?.();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("text response is still available"),
    );
  });
});
