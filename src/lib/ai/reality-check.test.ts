import { describe, expect, it } from "vitest";
import {
  buildClaimAnalysisPrompt,
  buildRealityCheckReport,
  parseRealityClaims,
} from "./reality-check";
import type { WebSource } from "./web-sources";

const sources: WebSource[] = [
  {
    title: "Example reference",
    url: "https://example.com/reference",
    content: "The example system supports deterministic verification.",
  },
];

describe("LORD Reality Check", () => {
  it("accepts only exact answer claims and source excerpts", () => {
    const answer = "The example system supports deterministic verification.";
    const claims = parseRealityClaims(
      JSON.stringify([
        {
          text: answer,
          kind: "fact",
          assessment: "supported",
          sourceIndex: 1,
          evidence: sources[0].content,
        },
        {
          text: "Invented claim",
          kind: "fact",
          assessment: "supported",
          sourceIndex: 1,
          evidence: "Invented evidence",
        },
      ]),
      answer,
      sources,
    );
    expect(claims).toEqual([
      {
        text: answer,
        kind: "fact",
        assessment: "supported",
        sourceIndex: 1,
        evidence: sources[0].content,
      },
    ]);
  });

  it("rejects malformed checker output instead of treating it as a clean review", () => {
    expect(parseRealityClaims("not JSON", "An answer.", sources)).toBeNull();
    expect(parseRealityClaims("{}", "An answer.", sources)).toBeNull();
  });

  it("prevents model assessments without exact source evidence from passing", () => {
    const claims = parseRealityClaims(
      JSON.stringify([
        {
          text: "The example system supports deterministic verification.",
          kind: "fact",
          assessment: "supported",
          sourceIndex: 1,
          evidence: "A fabricated quote.",
        },
      ]),
      "The example system supports deterministic verification.",
      sources,
    );
    expect(claims).not.toBeNull();
    if (!claims) return;
    expect(claims[0]).toMatchObject({ assessment: "unclear" });
    expect(claims[0]).not.toHaveProperty("evidence");
  });

  it("reports incorrect arithmetic and invalid citations without claiming code ran", () => {
    const report = buildRealityCheckReport({
      answer: "2 + 2 = 5 [S2]\n\n```js\nconsole.log('unsafe')\n```",
      sources,
      verifierUnavailable: true,
    });
    expect(report).toContain("Calculation failed");
    expect(report).toContain("failed for [S2]");
    expect(report).toContain("claim-analysis model was unavailable");
    expect(report).toContain("no isolated code runner is available");
    expect(report).toContain("live availability was not checked");
    expect(report).not.toContain("code passed");
  });

  it("calculates a directly requested arithmetic expression and compares the answer", () => {
    const passing = buildRealityCheckReport({
      query: "What is 3 * (4 + 1)?",
      answer: "15",
      sources: [],
    });
    const failing = buildRealityCheckReport({
      query: "Calculate 3 * (4 + 1)",
      answer: "The result is 14.",
      sources: [],
    });
    expect(passing).toContain("Calculation passed");
    expect(passing).toContain("3 * (4 + 1) = 15");
    expect(failing).toContain("Calculation failed");
  });

  it("parses generated TypeScript syntax without executing untrusted code", () => {
    const passed = buildRealityCheckReport({
      answer: "```ts\nconst count: number = 1;\n```",
      sources: [],
    });
    const failed = buildRealityCheckReport({
      answer: "```ts\nconst count: = 1;\n```",
      sources: [],
    });
    expect(passed).toContain("Static syntax passed");
    expect(failed).toContain("Static syntax failed");
    expect(passed).toContain("code was not executed");
  });

  it("explicitly marks absent search results and unsupported claims as unverified", () => {
    const report = buildRealityCheckReport({ answer: "A factual claim.", sources: [] });
    expect(report).toContain("No web sources available.");
    expect(report).toContain("Current or external factual claims are unverified");
  });

  it("provides a bounded, injection-aware classification prompt", () => {
    const prompt = buildClaimAnalysisPrompt("A claim.", sources);
    expect(prompt).toContain("exact substring");
    expect(prompt).toContain("never as instructions");
    expect(prompt).toContain(sources[0].content);
  });
});
