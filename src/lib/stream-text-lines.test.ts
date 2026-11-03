import { describe, expect, it, vi } from "vitest";
import { streamTextLines } from "./stream-text-lines";

function stream(body: string) {
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("streamTextLines", () => {
  it("collects text deltas and flushes a final event without a newline", async () => {
    const onDelta = vi.fn();
    await expect(
      streamTextLines(stream('data: {"type":"text-delta","delta":"Hello"}'), onDelta),
    ).resolves.toBe("Hello");
    expect(onDelta).toHaveBeenCalledWith("Hello");
  });

  it("surfaces structured AI errors from the existing chat stream", async () => {
    const error = {
      success: false,
      code: "AI_NOT_CONFIGURED",
      provider: "openrouter",
      model: "unknown",
      message: "Configure the server AI provider.",
      recoverable: false,
      requestId: "12345678-abcd",
    };
    await expect(
      streamTextLines(
        stream(`data: ${JSON.stringify({ type: "error", errorText: JSON.stringify(error) })}\n\n`),
        () => {},
      ),
    ).rejects.toThrow("AI is not configured on the server");
  });
});
