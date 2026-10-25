import { describe, expect, it } from "vitest";
import { getSafeErrorMessage } from "./api-error";

describe("API error messages", () => {
  it("preserves the safe message from non-Error database responses", () => {
    expect(
      getSafeErrorMessage({
        code: "42703",
        message: "column memories.archived does not exist",
      }),
    ).toBe("column memories.archived does not exist");
  });

  it("uses the message from Error instances and a clear fallback otherwise", () => {
    expect(getSafeErrorMessage(new Error("Request failed"))).toBe("Request failed");
    expect(getSafeErrorMessage({ code: "UNKNOWN" })).toBe(
      "The request failed without an error message.",
    );
  });
});
