import { describe, expect, it } from "vitest";
import { errorFromStatus } from "./errors";

describe("OpenRouter error classification", () => {
  it("preserves Retry-After without exposing provider text", () => {
    const error = errorFromStatus(
      429,
      { error: { code: "rate_limit_exceeded", message: "secret provider detail" } },
      new Headers({ "Retry-After": "3" }),
    );

    expect(error.kind).toBe("rate_limit");
    expect(error.providerCode).toBe("rate_limit_exceeded");
    expect(error.retryAfterMs).toBe(3000);
    expect(error.message).not.toContain("secret");
  });

  it("classifies credit exhaustion separately from temporary throttling", () => {
    expect(errorFromStatus(429, { error: { code: "insufficient_quota" } }).kind).toBe(
      "insufficient_credits",
    );
    expect(errorFromStatus(402).kind).toBe("insufficient_credits");
  });

  it("sanitizes provider codes and recognizes quota text when the code is numeric", () => {
    const noisyCode = errorFromStatus(429, {
      error: { code: "rate_limit\nsecret detail", message: "ordinary throttling" },
    });
    expect(noisyCode.providerCode).toBeUndefined();

    const exhausted = errorFromStatus(429, {
      error: { code: 429, message: "Account quota exhausted" },
    });
    expect(exhausted.kind).toBe("insufficient_credits");
    expect(exhausted.providerCode).toBe("insufficient_quota");
  });

  it("does not classify authentication or model errors as rate limits", () => {
    expect(errorFromStatus(401).kind).toBe("invalid_api_key");
    expect(errorFromStatus(404).kind).toBe("unsupported_model");
    expect(errorFromStatus(403, { error: { code: "model_not_available" } }).kind).toBe(
      "unsupported_model",
    );
  });
});
