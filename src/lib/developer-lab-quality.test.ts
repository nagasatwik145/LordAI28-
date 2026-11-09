import { describe, expect, it } from "vitest";
import {
  DEVELOPER_LAB_MODEL,
  buildDeveloperLabSystemPrompt,
  buildDeveloperLabUserPrompt,
} from "./developer-lab-quality";

describe("Developer Lab prompt quality", () => {
  it("uses a reusable respectful senior-engineer system policy", () => {
    const prompt = buildDeveloperLabSystemPrompt("explain");
    expect(prompt).toContain("professional senior software engineer");
    expect(prompt).toContain("Never insult the user");
    expect(prompt).toContain("Never fabricate");
    expect(prompt).toContain("does not execute code");
    expect(prompt).toContain("Task: Explain Code.");
  });

  it("gives each action a dedicated structure", () => {
    expect(buildDeveloperLabSystemPrompt("debug")).toContain("Task: Debug.");
    expect(buildDeveloperLabSystemPrompt("refactor")).toContain("behavior-preserving");
    expect(buildDeveloperLabSystemPrompt("tests")).toContain("Do not claim the tests were run");
    expect(buildDeveloperLabSystemPrompt("security")).toContain(
      "Critical, High, Medium, Low, or Informational",
    );
    expect(buildDeveloperLabSystemPrompt("document")).toContain("concise usage example");
  });

  it("builds prompts with untrusted source and supplied context", () => {
    const prompt = buildDeveloperLabUserPrompt({
      action: "debug",
      code: "const x = y",
      language: "typescript",
      errorMessage: "ReferenceError: y is not defined",
      environment: "Node 22",
      framework: "Vitest",
    });
    expect(prompt).toContain("Language: typescript");
    expect(prompt).toContain("Test framework: Vitest");
    expect(prompt).toContain("ReferenceError: y is not defined");
    expect(prompt).toContain("Environment details:\nNode 22");
    expect(prompt).toContain("Source code (untrusted input):");
    expect(prompt).toContain("```typescript");
    expect(prompt).toContain("const x = y");
  });

  it("exposes a configurable model default", () => {
    expect(DEVELOPER_LAB_MODEL).toBeTruthy();
  });
});
