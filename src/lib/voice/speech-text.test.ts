import { describe, expect, it } from "vitest";
import { normalizeSpeechText } from "./speech-text";

describe("normalizeSpeechText", () => {
  it("removes decorative symbol sequences without changing the displayed text", () => {
    expect(normalizeSpeechText("@ ! > . $ # & * ( ) ^ % _ + + = |")).toBe("");
  });

  it("speaks meaningful currency, percentages, math, and handles", () => {
    expect(normalizeSpeechText("50% costs $100. A + B = C. @username")).toBe(
      "50 percent costs 100 dollars. A plus B equals C. at username",
    );
  });

  it("removes Markdown syntax but keeps link labels and readable destinations", () => {
    const spoken = normalizeSpeechText(
      "## Useful **answer**\n\n- Read [the guide](https://example.com/docs?q=1).\n> Keep the quote.",
    );
    expect(spoken).toContain("Useful answer");
    expect(spoken).toContain("Read the guide");
    expect(spoken).toContain("example dot com slash docs, query q equals 1");
    expect(spoken).toContain("Keep the quote");
    expect(spoken).not.toMatch(/[#*`|]/);
  });

  it("turns fenced JSON into key and value phrases", () => {
    expect(normalizeSpeechText('Result: ```json\n{"ok":true,"count":3}\n```')).toBe(
      "Result: ok: true. count: 3",
    );
  });

  it("speaks raw JSON as fields instead of punctuation", () => {
    expect(normalizeSpeechText('{"email":"a+b@example.com","total":"$100"}')).toBe(
      "email: a plus b at example dot com. total: 100 dollars",
    );
  });

  it("speaks code and mathematical operators as words", () => {
    expect(normalizeSpeechText("Use `foo_bar`; x === 2, 2 * 3 >= 6, and x^2.")).toBe(
      "Use foo bar; x is strictly equal to 2, 2 times 3 is greater than or equal to 6, and x to the power of 2.",
    );
    expect(normalizeSpeechText("Return Promise<User> from the function.")).toBe(
      "Return Promise of User from the function.",
    );
  });

  it("speaks email addresses and URLs without reading delimiter characters", () => {
    expect(normalizeSpeechText("Email name@example.com or visit https://example.com/a-b.")).toBe(
      "Email name at example dot com or visit example dot com slash a-b.",
    );
  });

  it("expands common abbreviations and ISO dates while preserving mixed-language words", () => {
    expect(normalizeSpeechText("Dr. Lee: e.g. 50% on 2026-11-09. Hola, 世界!")).toBe(
      "Doctor Lee: for example 50 percent on November 9, 2026. Hola, 世界.",
    );
  });

  it("removes HTML and decodes entities", () => {
    expect(normalizeSpeechText("<p>Fish &amp; chips</p> &lt;safe&gt;")).toBe("Fish and chips safe");
  });

  it("reads table cells and list content without Markdown bars or bullets", () => {
    expect(
      normalizeSpeechText("| Name | Score |\n| --- | --- |\n| Ada | 50% |\n\n- Next step"),
    ).toBe("Name, Score. Ada, 50 percent. Next step");
  });

  it("is stable when applied at both client and server TTS boundaries", () => {
    const once = normalizeSpeechText("A + B = 3, visit https://example.com.");
    expect(normalizeSpeechText(once)).toBe(once);
  });
});
