import { describe, expect, it } from "vitest";
import {
  DeveloperRequestSchema,
  DeveloperSessionSchema,
  developerApiError,
  formatApiResponse,
  formatDeveloperOutput,
  requiresRequestConfirmation,
  redactApiUrl,
  validateBrowserApiUrl,
} from "./developer-lab";

describe("Developer Lab request validation", () => {
  it("accepts bounded analysis requests and optional debugging context", () => {
    expect(
      DeveloperRequestSchema.safeParse({
        action: "debug",
        code: "const x = 1",
        language: "typescript",
        errorMessage: "ReferenceError",
      }).success,
    ).toBe(true);
  });

  it("rejects unsupported actions, empty code, and oversized source", () => {
    expect(
      DeveloperRequestSchema.safeParse({ action: "execute", code: "x", language: "js" }).success,
    ).toBe(false);
    expect(
      DeveloperRequestSchema.safeParse({ action: "explain", code: "", language: "js" }).success,
    ).toBe(false);
    expect(
      DeveloperRequestSchema.safeParse({
        action: "explain",
        code: "x".repeat(40_001),
        language: "js",
      }).success,
    ).toBe(false);
  });
});

describe("Developer Lab session authorization boundary", () => {
  it("accepts bounded session fields but rejects client supplied ownership", () => {
    const session = {
      title: "sample.ts",
      action: "explain",
      language: "typescript",
      code: "const x = 1",
      output: "A constant assignment",
    };
    expect(DeveloperSessionSchema.safeParse(session).success).toBe(true);
    expect(DeveloperSessionSchema.safeParse({ ...session, user_id: "another-user" }).success).toBe(
      false,
    );
  });
});

describe("Developer Lab result formatting", () => {
  it("accepts structured AI content and always marks execution as false", () => {
    expect(formatDeveloperOutput({ content: "  Suggested fix  ", executed: true })).toEqual({
      content: "Suggested fix",
      executed: false,
    });
    expect(formatDeveloperOutput({ content: "  " })).toBeNull();
    expect(formatDeveloperOutput(null)).toBeNull();
  });

  it("extracts safe errors and provides a fallback", () => {
    expect(developerApiError({ error: { message: "AI unavailable" } })).toBe("AI unavailable");
    expect(developerApiError({})).toBe("Request failed. Please try again.");
  });

  it("bounds displayed API response content", () => {
    expect(formatApiResponse("response", 3)).toBe("res\n[Response truncated]");
  });
});

describe("browser API request validation", () => {
  it("allows HTTP(S) URLs and rejects schemes or embedded credentials", () => {
    expect(validateBrowserApiUrl("https://example.com/v1")).not.toBeNull();
    expect(validateBrowserApiUrl("file:///etc/passwd")).toBeNull();
    expect(validateBrowserApiUrl("https://user:pass@example.com")).toBeNull();
    expect(validateBrowserApiUrl("invalid")).toBeNull();
  });

  it("requires confirmation before destructive API requests", () => {
    expect(requiresRequestConfirmation("DELETE")).toBe(true);
    expect(requiresRequestConfirmation("delete")).toBe(true);
    expect(requiresRequestConfirmation("POST")).toBe(false);
  });

  it("redacts sensitive query values before request history is saved", () => {
    expect(redactApiUrl("https://example.com?api_key=private&limit=3")).toBe(
      "https://example.com/?api_key=%5Bredacted%5D&limit=3",
    );
  });
});
