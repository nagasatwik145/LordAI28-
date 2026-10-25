import { describe, expect, it } from "vitest";
import { AnalyticsEventSchema } from "./analytics-schema";

describe("product analytics event schema v1", () => {
  it("accepts documented minimal events", () => {
    expect(
      AnalyticsEventSchema.safeParse({ event: "chat_succeeded", feature: "chat", durationMs: 400 })
        .success,
    ).toBe(true);
  });
  it("rejects arbitrary names, sensitive payloads, and unbounded metrics", () => {
    for (const input of [
      { event: "unknown_event" },
      { event: "chat_succeeded", message: "private content" },
      { event: "chat_failed", category: "password" },
      { event: "chat_succeeded", durationMs: 3_600_001 },
    ])
      expect(AnalyticsEventSchema.safeParse(input).success).toBe(false);
  });
});
