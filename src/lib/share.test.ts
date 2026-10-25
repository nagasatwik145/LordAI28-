import { describe, expect, it } from "vitest";
import { isShareToken } from "./share";

describe("isShareToken", () => {
  it("accepts UUID share tokens", () => {
    expect(isShareToken("00000000-0000-4000-8000-000000000000")).toBe(true);
  });

  it("rejects malformed tokens before they are sent to the database", () => {
    expect(isShareToken("smoke-id")).toBe(false);
    expect(isShareToken("00000000-0000-4000-8000-00000000000z")).toBe(false);
  });
});
