import { describe, expect, it } from "vitest";
import { detectProblemSolvingIntent } from "@/lib/problem-solving-intent";

describe("detectProblemSolvingIntent", () => {
  it("flags equation-solving requests", () => {
    expect(detectProblemSolvingIntent("Solve this equation: 2x + 3 = 11").kind).toBe("solve");
    expect(detectProblemSolvingIntent("Solve this equation: 2x + 3 = 11").subject).toBe(
      "mathematics",
    );
    expect(detectProblemSolvingIntent("Find the answer to this question.").kind).toBe("solve");
  });

  it("flags worksheet and image-style exercises", () => {
    const intent = detectProblemSolvingIntent("Solve these questions.", ["image", "pdf"]);
    expect(intent.kind).toBe("solve");
  });

  it("detects chemistry balancing tasks", () => {
    expect(detectProblemSolvingIntent("Balance this chemistry equation.").subject).toBe(
      "chemistry",
    );
  });

  it("does not interrupt hint-only or answer-checking requests", () => {
    expect(detectProblemSolvingIntent("Give me a hint for this algebra problem").kind).toBe("hint");
    expect(detectProblemSolvingIntent("Check my answer to this physics numerical.").kind).toBe(
      "check-answer",
    );
  });

  it("ignores general explanations and translations", () => {
    expect(detectProblemSolvingIntent("Explain photosynthesis in simple words.").kind).toBe(
      "general-education",
    );
    expect(detectProblemSolvingIntent("Translate this paragraph to Spanish").kind).toBe("none");
  });
});
