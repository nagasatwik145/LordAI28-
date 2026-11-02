import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLordConfig } from "../config";
import { registerCodeTools } from "./code";
import { getTool } from "../registry";

let allowedDir = "";
let outsideDir = "";
let previousAllowedDirs: string | undefined;

beforeEach(() => {
  previousAllowedDirs = process.env.LORD_ALLOWED_DIRS;
  allowedDir = fs.mkdtempSync(path.join(os.tmpdir(), "lord-code-allowed-"));
  outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "lord-code-outside-"));
  process.env.LORD_ALLOWED_DIRS = JSON.stringify([allowedDir]);
  resetLordConfig();
  registerCodeTools();
});

afterEach(() => {
  if (previousAllowedDirs === undefined) delete process.env.LORD_ALLOWED_DIRS;
  else process.env.LORD_ALLOWED_DIRS = previousAllowedDirs;
  resetLordConfig();
  fs.rmSync(allowedDir, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

describe("code.analyze", () => {
  it("reviews allowed source through the tool context model router", async () => {
    const sourcePath = path.join(allowedDir, "App.tsx");
    fs.writeFileSync(
      sourcePath,
      'const apiKey = "private-credential-value-123"; export function App() { return null; }',
    );
    const llm = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        bugs: [],
        securityIssues: [],
        performanceIssues: [],
        missingTests: [],
        readabilityImprovements: [],
        architectureSuggestions: [],
        confidence: 0.82,
        riskLevel: "low",
      }),
      provider: "openrouter",
    });
    const tool = getTool("code.analyze")!;

    const result = await tool.execute({ path: sourcePath, focus: "correctness" }, { llm } as never);

    expect(result.success).toBe(true);
    expect(result.data?.review).toContain("No concrete issues were identified.");
    expect(result.data?.report).toMatchObject({ confidence: 0.82, riskLevel: "low" });
    expect(llm).toHaveBeenCalledWith(expect.objectContaining({ mode: "reasoning" }));
    expect(llm.mock.calls[0][0].prompt).not.toContain("private-credential-value-123");
  });

  it("rejects malformed reports instead of presenting unverified findings", async () => {
    const sourcePath = path.join(allowedDir, "App.tsx");
    fs.writeFileSync(sourcePath, "export function App() { return null; }");
    const llm = vi.fn();
    llm.mockResolvedValue({ text: "This code is dangerous.", provider: "openrouter" });

    const result = await getTool("code.analyze")!.execute({ path: sourcePath }, { llm } as never);

    expect(result).toMatchObject({ success: false, errorCode: "INVALID_REVIEW_REPORT" });
  });

  it("rejects hidden files and symlink escapes without calling a model", async () => {
    const secretPath = path.join(allowedDir, ".env.local");
    fs.writeFileSync(secretPath, "SECRET=value");
    fs.symlinkSync(outsideDir, path.join(allowedDir, "escape"), "dir");
    const llm = vi.fn().mockResolvedValue({ text: "review", provider: "openrouter" });
    const tool = getTool("code.analyze")!;

    const hidden = await tool.execute({ path: secretPath }, { llm } as never);
    const escaped = await tool.execute({ path: path.join(allowedDir, "escape", "source.ts") }, {
      llm,
    } as never);

    expect(hidden.success).toBe(false);
    expect(escaped.success).toBe(false);
    expect(llm).not.toHaveBeenCalled();
  });
});

describe("code.validate", () => {
  it("runs only an existing allowlisted script inside the approved project root", async () => {
    fs.writeFileSync(
      path.join(allowedDir, "package.json"),
      JSON.stringify({ scripts: { test: "echo validation-ok" } }),
    );
    const tool = getTool("code.validate")!;

    expect(tool.risk).toBe("high");
    expect(tool.requiresConfirmation).toBe(true);
    const result = await tool.execute({ script: "test" }, {
      signal: new AbortController().signal,
    } as never);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ script: "test", exitCode: 0 });
    expect(result.message).toContain("validation-ok");
  });

  it("rejects arbitrary scripts and reports missing package scripts", async () => {
    const tool = getTool("code.validate")!;
    const signal = new AbortController().signal;

    await expect(tool.execute({ script: "install" }, { signal } as never)).resolves.toMatchObject({
      success: false,
      errorCode: "VALIDATION_SCRIPT_DENIED",
    });
    fs.writeFileSync(path.join(allowedDir, "package.json"), JSON.stringify({ scripts: {} }));
    await expect(tool.execute({ script: "test" }, { signal } as never)).resolves.toMatchObject({
      success: false,
      errorCode: "VALIDATION_SCRIPT_NOT_FOUND",
    });
  });

  it("does not follow a package manifest symlink outside the allowed root", async () => {
    fs.writeFileSync(
      path.join(outsideDir, "package.json"),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
    );
    fs.symlinkSync(path.join(outsideDir, "package.json"), path.join(allowedDir, "package.json"));

    const result = await getTool("code.validate")!.execute({ script: "test" }, {
      signal: new AbortController().signal,
    } as never);

    expect(result).toMatchObject({ success: false, errorCode: "VALIDATION_SCRIPT_NOT_FOUND" });
  });

  it("reports nonzero package script exits as validation failures", async () => {
    fs.writeFileSync(
      path.join(allowedDir, "package.json"),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(7)"' } }),
    );

    const result = await getTool("code.validate")!.execute({ script: "test" }, {
      signal: new AbortController().signal,
    } as never);

    expect(result).toMatchObject({ success: false, errorCode: "VALIDATION_FAILED" });
    expect(result.data).toMatchObject({ script: "test", exitCode: 7 });
  });
});

describe("patch tools", () => {
  it("applies a minimal exact replacement and can reverse it", async () => {
    const filePath = path.join(allowedDir, "auth.ts");
    const original = "export function getUser() { return null; }\n";
    const updated = "export function getUser() { return undefined; }\n";
    fs.writeFileSync(filePath, original);
    const apply = getTool("patch.apply")!;
    const rollback = getTool("patch.rollback")!;

    expect(apply.risk).toBe("high");
    expect(apply.requiresConfirmation).toBe(true);
    const applied = await apply.execute(
      { path: filePath, expected: "return null;", replacement: "return undefined;" },
      {} as never,
    );
    expect(applied.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe(updated);

    const restored = await rollback.execute(
      { path: filePath, expected: "return undefined;", replacement: "return null;" },
      {} as never,
    );
    expect(restored.success).toBe(true);
    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
  });

  it("rejects ambiguous context and syntax errors without modifying the file", async () => {
    const filePath = path.join(allowedDir, "source.ts");
    const original = "export function run() { return 1; }\nexport function second() { return 2; }";
    fs.writeFileSync(filePath, original);
    const tool = getTool("patch.apply")!;

    const ambiguous = await tool.execute(
      { path: filePath, expected: "return", replacement: "return " },
      {} as never,
    );
    const invalidSyntax = await tool.execute(
      {
        path: filePath,
        expected: "return 1;",
        replacement: "return ( ;",
      },
      {} as never,
    );

    expect(ambiguous).toMatchObject({ success: false, errorCode: "PATCH_CONTEXT_MISMATCH" });
    expect(invalidSyntax).toMatchObject({ success: false, errorCode: "PATCH_UNSAFE" });
    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
  });

  it("rejects unresolved imports, duplicate exports, and introduced cycles", async () => {
    const authPath = path.join(allowedDir, "auth.ts");
    const otherPath = path.join(allowedDir, "other.ts");
    fs.writeFileSync(authPath, "export function getUser() { return null; }\n");
    fs.writeFileSync(
      otherPath,
      'import { getUser } from "./auth";\nexport const useUser = getUser;\n',
    );
    const tool = getTool("patch.apply")!;

    const unresolved = await tool.execute(
      {
        path: authPath,
        expected: "return null;",
        replacement: 'import { missing } from "./missing"; return missing;',
      },
      {} as never,
    );
    const duplicate = await tool.execute(
      {
        path: authPath,
        expected: "function getUser()",
        replacement: "function useUser()",
      },
      {} as never,
    );
    const cycle = await tool.execute(
      {
        path: authPath,
        expected: "return null;",
        replacement: 'import { useUser } from "./other"; return useUser;',
      },
      {} as never,
    );

    expect(unresolved).toMatchObject({ success: false, errorCode: "PATCH_UNSAFE" });
    expect(duplicate).toMatchObject({ success: false, errorCode: "PATCH_UNSAFE" });
    expect(cycle).toMatchObject({ success: false, errorCode: "PATCH_UNSAFE" });
    expect(fs.readFileSync(authPath, "utf8")).toBe("export function getUser() { return null; }\n");
  });
});
