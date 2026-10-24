import { describe, expect, it } from "vitest";
import {
  buildSandboxedWebsitePreview,
  buildDeliverablePrompt,
  createDeliverableDependencies,
  parseStudioSpecOutput,
  StudioSpecSchema,
  validateStudioArtifact,
} from "./anything-studio";

const validSpec = {
  name: "Garden Notes",
  summary: "A small gardening companion.",
  audience: "Home gardeners",
  goals: ["Track planting"],
  features: ["Seasonal reminders"],
  design: "Calm green palette",
  architecture: "A static web prototype",
  constraints: ["Mobile friendly"],
};

describe("Anything Studio artifacts", () => {
  it("parses only the shared specification shape", () => {
    expect(parseStudioSpecOutput(JSON.stringify(validSpec))).toEqual(validSpec);
    expect(() => parseStudioSpecOutput('{"name":"incomplete"}')).toThrow();
    expect(StudioSpecSchema.safeParse({ ...validSpec, secret: "value" }).success).toBe(false);
  });

  it("records only selected deliverable dependencies", () => {
    const dependencies = createDeliverableDependencies(["source_code", "test_cases", "website"]);
    expect(dependencies.test_cases).toEqual(["source_code"]);
    expect(dependencies.source_code).toEqual([]);
    expect(dependencies.launch_checklist).toEqual([]);
  });

  it("validates the expected format and rejects credential-shaped output", () => {
    const website =
      "<!doctype html><html><head><title>Garden</title></head><body><h1>Garden</h1></body></html>";
    expect(validateStudioArtifact("website", website).valid).toBe(true);
    expect(validateStudioArtifact("website", "just some text").valid).toBe(false);
    expect(
      validateStudioArtifact(
        "source_code",
        'const key = "sk-123456789012345678901234567890";\nexport const app = true;',
      ).valid,
    ).toBe(false);
    expect(
      validateStudioArtifact(
        "test_cases",
        "- [ ] Opens the page\n- [ ] Saves changes\n- [ ] Handles errors",
      ).valid,
    ).toBe(true);
  });

  it("includes the shared spec and completed dependencies in generation prompts", () => {
    const prompt = buildDeliverablePrompt("test_cases", "Build a garden planner", validSpec, [
      { kind: "source_code", title: "Starter", content: "export function plant() {}" },
    ]);
    expect(prompt).toContain("Approved project specification:");
    expect(prompt).toContain('"name": "Garden Notes"');
    expect(prompt).toContain("export function plant()");
    expect(prompt).toContain("Do not include credentials");
    expect(buildDeliverablePrompt("website", "Make a site", validSpec, [])).toContain(
      "do not load scripts",
    );
  });

  it("restricts website previews to inline, non-script resources", () => {
    const preview = buildSandboxedWebsitePreview(
      "<!doctype html><html><head><title>Preview</title></head><body>Example</body></html>",
    );
    expect(preview).toContain("default-src 'none'");
    expect(preview).toContain("style-src 'unsafe-inline'");
    expect(preview).not.toContain("script-src");
  });
});
