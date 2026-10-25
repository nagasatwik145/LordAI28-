import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterError } from "./errors";

const mocks = vi.hoisted(() => ({
  streamChat: vi.fn(),
  completeChat: vi.fn(),
  getAIConfig: vi.fn(() => ({ openRouterApiKey: "test-key" })),
}));

vi.mock("./config", () => ({
  AIConfigurationError: class AIConfigurationError extends Error {},
  getAIConfig: mocks.getAIConfig,
}));

vi.mock("./client", () => ({
  OpenRouterClient: class MockOpenRouterClient {
    async completeChat(...args: unknown[]) {
      return mocks.completeChat(...args);
    }

    async *streamChatEvents(...args: unknown[]) {
      for await (const delta of mocks.streamChat(...args)) {
        if (delta) yield { type: "text", delta };
      }
    }
  },
}));

import { streamChat } from "./gateway";
import { clearModelAvailabilityForTests } from "./model-availability";

async function* tokens(...values: string[]) {
  yield* values;
}

describe("streamChat", () => {
  beforeEach(() => {
    mocks.streamChat.mockReset();
    mocks.completeChat.mockReset();
    mocks.getAIConfig.mockClear();
    clearModelAvailabilityForTests();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the next free candidate after a rate limit", async () => {
    mocks.streamChat
      .mockImplementationOnce(async function* () {
        yield "";
        throw new OpenRouterError("rate_limit", 429);
      })
      .mockImplementationOnce(() => tokens("Lord is ready."));

    const response = streamChat(
      [{ role: "user", content: "hello" }],
      undefined,
      ["first-model:free", "second-model:free"],
      "00000000-0000-4000-8000-000000000001",
    );
    const body = await response.text();

    expect(mocks.streamChat.mock.calls.map((call) => call[1])).toEqual([
      "first-model:free",
      "second-model:free",
    ]);
    expect(body).toContain("Lord is ready.");
  });

  it("treats an empty model stream as unavailable and retries", async () => {
    mocks.streamChat
      .mockImplementationOnce(() => tokens())
      .mockImplementationOnce(() => tokens("Recovered response."));

    const response = streamChat(
      [{ role: "user", content: "hello" }],
      undefined,
      ["empty-model:free", "working-model:free"],
      "00000000-0000-4000-8000-000000000002",
    );

    expect(await response.text()).toContain("Recovered response.");
    expect(mocks.streamChat).toHaveBeenCalledTimes(2);
  });

  it("appends the exact searched sources after the generated answer", async () => {
    mocks.streamChat.mockImplementationOnce(() => tokens("The current fact is supported [S1]."));
    const response = streamChat(
      [{ role: "user", content: "hello" }],
      undefined,
      ["free-model:free"],
      "00000000-0000-4000-8000-000000000004",
      [
        {
          title: "Reference",
          url: "https://example.com/source",
          content: "Evidence",
          verification: "page",
        },
      ],
      1400,
      undefined,
      { status: "complete", sourceCount: 1, verifiedPageCount: 1 },
    );
    const body = await response.text();
    expect(body).toContain("The current fact is supported [S1].");
    expect(body).toContain("[Reference](<https://example.com/source>)");
    expect(body).toContain("page accessed");
    expect(body).toContain('"type":"data-web-research","data":{"status":"complete"');
  });

  it("keeps normal chat free of research status and source UI data", async () => {
    mocks.streamChat.mockImplementationOnce(() => tokens("A direct answer."));
    const response = streamChat(
      [{ role: "user", content: "hello" }],
      undefined,
      ["free-model:free"],
      "00000000-0000-4000-8000-000000000006",
    );
    const body = await response.text();
    expect(body).toContain("A direct answer.");
    expect(body).not.toContain("data-web-research");
    expect(body).not.toContain("data-web-sources");
  });

  it("adds evidence-backed Reality Check results after the generated answer", async () => {
    const answer = "The source confirms the example claim.";
    mocks.streamChat.mockImplementationOnce(() => tokens(answer));
    mocks.completeChat.mockResolvedValue(
      JSON.stringify([
        {
          text: answer,
          kind: "fact",
          assessment: "supported",
          sourceIndex: 1,
          evidence: "The source confirms the example claim.",
        },
      ]),
    );

    const response = streamChat(
      [{ role: "user", content: "Is this claim supported?" }],
      undefined,
      ["free-model:free"],
      "00000000-0000-4000-8000-000000000005",
      [
        {
          title: "Example source",
          url: "https://example.com/source",
          content: "The source confirms the example claim.",
        },
      ],
      1400,
      { enabled: true },
    );
    const body = await response.text();

    expect(body).toContain("The source confirms the example claim.");
    expect(body).toContain("fact — supported evidence");
    expect(body).toContain("not independent proof");
    expect(body).toContain("data-reality-check");
    expect(mocks.completeChat).toHaveBeenCalledTimes(1);
  });

  it("shows an unavailable report rather than a false success when claim analysis fails", async () => {
    mocks.streamChat.mockImplementationOnce(() => tokens("A current factual claim."));
    mocks.completeChat.mockRejectedValue(new OpenRouterError("rate_limit", 429));
    const response = streamChat(
      [{ role: "user", content: "Check this." }],
      undefined,
      ["free-model:free"],
      "00000000-0000-4000-8000-000000000006",
      [],
      1400,
      { enabled: true },
    );

    const body = await response.text();
    expect(body).toContain("claim-analysis model was unavailable");
    expect(body).toContain("Current or external factual claims are unverified");
    expect(body).not.toContain("factual claims passed");
  });

  it("returns a structured, correlated error after all candidates fail", async () => {
    mocks.streamChat.mockImplementation(async function* () {
      yield "";
      throw new OpenRouterError("rate_limit", 429);
    });

    const response = streamChat(
      [{ role: "user", content: "hello" }],
      undefined,
      ["limited-model:free"],
      "00000000-0000-4000-8000-000000000003",
    );
    const body = await response.text();

    expect(body).toContain("00000000-0000-4000-8000-000000000003");
    expect(body).toContain("AI_RATE_LIMITED");
    expect(body).not.toContain("hello");
  });
});
