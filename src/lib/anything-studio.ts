import { z } from "zod";
import { validateGameSpec } from "@/lib/games/game-runtime";

export const STUDIO_DELIVERABLES = [
  "website",
  "project_plan",
  "source_code",
  "test_cases",
  "game",
  "image",
  "launch_checklist",
  "user_documentation",
] as const;

export type StudioDeliverableType = (typeof STUDIO_DELIVERABLES)[number];
export type StudioArtifactStatus = "pending" | "generating" | "completed" | "failed" | "stale";

export const StudioSpecSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(700),
    audience: z.string().trim().min(1).max(300),
    goals: z.array(z.string().trim().min(1).max(200)).min(1).max(8),
    features: z.array(z.string().trim().min(1).max(200)).min(1).max(12),
    design: z.string().trim().min(1).max(500),
    architecture: z.string().trim().min(1).max(500),
    constraints: z.array(z.string().trim().min(1).max(200)).max(10),
  })
  .strict();

export type StudioSpec = z.infer<typeof StudioSpecSchema>;

export interface StudioValidation {
  valid: boolean;
  checks: { name: string; passed: boolean; message: string }[];
}

export interface StudioDeliverableDefinition {
  label: string;
  description: string;
  fileName: string;
  mimeType: string;
  language: string;
  dependencies: StudioDeliverableType[];
}

export const STUDIO_DELIVERABLE_DEFINITIONS: Record<
  StudioDeliverableType,
  StudioDeliverableDefinition
> = {
  website: {
    label: "Website prototype",
    description: "A static HTML/CSS prototype with an isolated preview.",
    fileName: "index.html",
    mimeType: "text/html",
    language: "html",
    dependencies: [],
  },
  project_plan: {
    label: "Project plan",
    description: "A phased plan grounded in the project specification.",
    fileName: "project-plan.md",
    mimeType: "text/markdown",
    language: "markdown",
    dependencies: [],
  },
  source_code: {
    label: "Source code",
    description: "A focused source-code starter aligned with the project plan.",
    fileName: "starter.ts",
    mimeType: "text/typescript",
    language: "typescript",
    dependencies: ["project_plan"],
  },
  test_cases: {
    label: "Test cases",
    description: "Manual and automated test scenarios for the source deliverable.",
    fileName: "test-cases.md",
    mimeType: "text/markdown",
    language: "markdown",
    dependencies: ["source_code"],
  },
  game: {
    label: "Game specification",
    description: "A game spec accepted by LORD's compatible game runtime and ZIP exporter.",
    fileName: "game-spec.json",
    mimeType: "application/json",
    language: "json",
    dependencies: [],
  },
  image: {
    label: "Image asset",
    description: "An image generated with the configured LORD image provider.",
    fileName: "project-image.png",
    mimeType: "image/png",
    language: "image",
    dependencies: [],
  },
  launch_checklist: {
    label: "Launch checklist",
    description: "A pre-launch checklist; deployment is not performed by this deliverable.",
    fileName: "launch-checklist.md",
    mimeType: "text/markdown",
    language: "markdown",
    dependencies: ["website", "source_code", "game"],
  },
  user_documentation: {
    label: "User documentation",
    description: "User-facing documentation based on the shared spec and completed outputs.",
    fileName: "user-guide.md",
    mimeType: "text/markdown",
    language: "markdown",
    dependencies: ["project_plan", "website", "source_code", "game"],
  },
};

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:ghp|github_pat|glpat)-[A-Za-z0-9_-]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export function containsStudioCredential(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

export function createDeliverableDependencies(
  selected: readonly StudioDeliverableType[],
): Record<StudioDeliverableType, StudioDeliverableType[]> {
  const selectedSet = new Set(selected);
  return Object.fromEntries(
    STUDIO_DELIVERABLES.map((kind) => [
      kind,
      selectedSet.has(kind)
        ? STUDIO_DELIVERABLE_DEFINITIONS[kind].dependencies.filter((item) => selectedSet.has(item))
        : [],
    ]),
  ) as Record<StudioDeliverableType, StudioDeliverableType[]>;
}

export function validateStudioArtifact(
  kind: StudioDeliverableType,
  content: string,
): StudioValidation {
  const checks: StudioValidation["checks"] = [];
  const add = (name: string, passed: boolean, message: string) =>
    checks.push({ name, passed, message });
  const trimmed = content.trim();

  add("non-empty", trimmed.length > 0, "Deliverable contains content.");
  add("size-limit", content.length <= 500_000, "Deliverable is within the 500 KB text limit.");
  add(
    "no-embedded-secret",
    !containsStudioCredential(content),
    "Deliverable does not contain a recognizable credential.",
  );

  if (trimmed && content.length <= 500_000) {
    switch (kind) {
      case "website":
        add(
          "html-document",
          /<!doctype html/i.test(content) && /<html[\s>]/i.test(content),
          "Website prototype has a valid HTML document shell.",
        );
        break;
      case "project_plan":
      case "launch_checklist":
      case "user_documentation":
        add(
          "markdown-structure",
          /^#{1,3}\s+\S/m.test(content) && content.length >= 100,
          "Document includes headings and substantive content.",
        );
        break;
      case "source_code":
        add(
          "source-structure",
          content.length >= 30 && !/^```/m.test(content),
          "Source code is non-trivial and is not wrapped in a Markdown code fence.",
        );
        break;
      case "test_cases":
        add(
          "test-scenarios",
          (content.match(/^\s*(?:[-*]|\d+[.)])\s+/gm) ?? []).length >= 3,
          "Test case document contains at least three listed scenarios.",
        );
        break;
      case "game": {
        let gameSpec: unknown;
        try {
          gameSpec = JSON.parse(content);
        } catch {
          gameSpec = null;
        }
        add(
          "compatible-game-spec",
          gameSpec !== null && validateGameSpec(gameSpec),
          "Game specification matches a schema supported by LORD's game runtime.",
        );
        break;
      }
      case "image":
        add(
          "image-url",
          /^https:\/\/\S+$/i.test(trimmed) ||
            /^data:image\/(?:png|jpeg|webp);base64,/i.test(trimmed),
          "Image deliverable points to an image asset.",
        );
        break;
    }
  }

  return { valid: checks.every((check) => check.passed), checks };
}

export function buildDeliverablePrompt(
  kind: Exclude<StudioDeliverableType, "game" | "image">,
  goal: string,
  spec: StudioSpec,
  dependencies: { kind: StudioDeliverableType; title: string; content: string }[],
): string {
  return [
    `Original request:\n${goal}`,
    `Approved project specification:\n${JSON.stringify(spec, null, 2)}`,
    dependencies.length
      ? `Completed related deliverables:\n${dependencies
          .map(
            ({ kind: dependencyKind, title, content }) =>
              `### ${dependencyKind}: ${title}\n${content.slice(0, 12_000)}`,
          )
          .join("\n\n")}`
      : "",
    `Create only the ${STUDIO_DELIVERABLE_DEFINITIONS[kind].label} deliverable.`,
    ...(kind === "website"
      ? [
          "Use standalone HTML with inline CSS; do not load scripts, stylesheets, fonts, or assets from external URLs.",
        ]
      : []),
    "Use only the request, approved specification, and included deliverables. Do not include credentials, secret values, internal application data, deployment claims, or APK-build claims.",
    "Return only the file contents in the requested format, without an outer Markdown code fence.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildSandboxedWebsitePreview(content: string): string {
  const policy =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;\">";
  if (/<head(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${policy}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(/<html(?:\s[^>]*)?>/i, (html) => `${html}<head>${policy}</head>`);
  }
  return `<!doctype html><html><head>${policy}</head><body>${content}</body></html>`;
}

export function parseStudioSpecOutput(output: string): StudioSpec {
  const cleaned = output.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return StudioSpecSchema.parse(JSON.parse(cleaned));
}

export function cleanGeneratedSource(output: string): string {
  const match = output.trim().match(/^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n```$/);
  return match?.[1] ?? output.trim();
}
