import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const tutorApi = readFileSync("src/routes/api/personal-tutor.ts", "utf8");
const graphApi = readFileSync("src/routes/api/knowledge-graph.ts", "utf8");

describe("Personal Tutor and Knowledge Graph persistence contracts", () => {
  it("maps generated tutor answers to the database column and includes correctness history", () => {
    expect(tutorApi).toContain('select("correct_index, is_correct, attempted_at")');
    expect(tutorApi).toContain("const { correctIndex, ...questionFields } = question;");
    expect(tutorApi).toContain("correct_index: correctIndex");
    expect(tutorApi).not.toContain("correctIndex: undefined");
  });

  it("builds review and delete mutations before applying ownership filters", () => {
    expect(graphApi).toContain('query.delete().eq("id", body.entityId).eq("user_id", userId)');
    expect(graphApi).toContain(".update({");
    expect(graphApi).toContain('.eq("id", body.entityId)');
    expect(graphApi).toContain('.eq("user_id", userId)');
  });
});
