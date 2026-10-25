import { describe, expect, it } from "vitest";
import { PROJECT_FILE_MAX_BYTES, validateProjectFile } from "./project-validation";

describe("project file validation", () => {
  it("accepts allowed private workspace file types below the storage limit", () => {
    expect(validateProjectFile({ type: "application/pdf", size: 1024 })).toBeNull();
    expect(validateProjectFile({ type: "text/markdown", size: 1024 })).toBeNull();
  });

  it("rejects unsupported types, empty files, and files above 20 MB", () => {
    expect(validateProjectFile({ type: "application/x-msdownload", size: 100 })).toMatch(/Use PDF/);
    expect(validateProjectFile({ type: "text/plain", size: 0 })).toMatch(/non-empty/);
    expect(validateProjectFile({ type: "image/png", size: PROJECT_FILE_MAX_BYTES + 1 })).toMatch(
      /20 MB/,
    );
  });
});
