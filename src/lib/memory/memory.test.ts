import { describe, expect, it, vi } from "vitest";
import { detectMemories } from "./detector";
import { retrieveMemories } from "./retrieval";
import { isMemoryActive, isMemoryEnabled, type MemoryRecord } from "./types";
import { arePossibleDuplicates } from "./graph";

vi.mock("./embeddings", () => ({
  embed: vi.fn(async () => {
    throw new Error("embedding provider unavailable");
  }),
  cosineSimilarity: vi.fn(() => 0),
}));

describe("memory safety and extraction", () => {
  it("defaults memory on unless the user explicitly disables it", () => {
    expect(isMemoryEnabled(undefined)).toBe(true);
    expect(isMemoryEnabled({ memory_enabled: true })).toBe(true);
    expect(isMemoryEnabled({ memory_enabled: false })).toBe(false);
  });

  it("rejects expired memories and keeps non-expiring or future memories active", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z");

    expect(isMemoryActive(null, now)).toBe(true);
    expect(isMemoryActive("2026-09-27T12:01:00.000Z", now)).toBe(true);
    expect(isMemoryActive("2026-09-27T11:59:00.000Z", now)).toBe(false);
    expect(isMemoryActive("not-a-date", now)).toBe(false);
  });

  it("extracts durable preferences while ignoring greetings and credentials", () => {
    expect(detectMemories("I prefer TypeScript.")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "preference", confidence: expect.any(Number) }),
      ]),
    );
    expect(detectMemories("My name is Satwik.")).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "profile" })]),
    );
    expect(detectMemories("I'm building LORD.")).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "project" })]),
    );
    expect(detectMemories("Hello there!")).toEqual([]);
    expect(detectMemories("My API key is abc123secretvalue")).toEqual([]);
    expect(detectMemories("I prefer TypeScript. I prefer TypeScript.")).toHaveLength(1);
  });

  it("stores unfinished commitments as expiring project memories", () => {
    const [task] = detectMemories("We'll finish authentication tomorrow.");

    expect(task).toMatchObject({
      category: "project",
      confidence: 0.88,
      content: "We'll finish authentication tomorrow",
    });
    expect(Date.parse(task.expiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(Date.parse(task.expiresAt ?? "")).toBeLessThanOrEqual(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );
  });
});

describe("semantic retrieval", () => {
  it("ranks matching project memories and omits unrelated memories", async () => {
    const memory = (id: string, content: string): MemoryRecord => ({
      id,
      user_id: "user-1",
      content,
      category: "project",
      pinned: false,
      confidence: 0.9,
      source: "auto",
      embedding: null,
      created_at: "2026-09-27T12:00:00.000Z",
      updated_at: "2026-09-27T12:00:00.000Z",
    });

    const results = await retrieveMemories(
      "React JWT authentication",
      [
        memory("auth", "React project uses JWT authentication with a backend API"),
        memory("style", "The user prefers concise TypeScript examples"),
      ],
      { lightweight: true, minSimilarity: 0.1 },
    );

    expect(results.map(({ memory: item }) => item.id)).toEqual(["auth"]);
  });

  it("does not retrieve suggestions, excluded memories, or memories when disabled", async () => {
    const makeMemory = (id: string): MemoryRecord => ({
      id,
      user_id: "user-1",
      content: "Project authentication uses React",
      category: "project",
      pinned: false,
      confidence: 0.9,
      source: "auto",
      embedding: null,
      created_at: "2026-09-27T12:00:00.000Z",
      updated_at: "2026-09-27T12:00:00.000Z",
    });
    const confirmed = makeMemory("confirmed");
    confirmed.confirmation_status = "confirmed";
    confirmed.use_in_context = true;
    const suggestion = makeMemory("suggested");
    suggestion.confirmation_status = "suggested";
    suggestion.use_in_context = true;
    const excluded = makeMemory("excluded");
    excluded.confirmation_status = "confirmed";
    excluded.use_in_context = false;

    const memories = [confirmed, suggestion, excluded];
    const retrieved = await retrieveMemories("React authentication", memories, {
      lightweight: true,
    });
    const disabled = await retrieveMemories("React authentication", memories, {
      lightweight: true,
      enabled: false,
    });

    expect(retrieved.map(({ memory: item }) => item.id)).toEqual(["confirmed"]);
    expect(disabled).toEqual([]);
  });

  it("isolates retrieval by user and project while retaining global memories", async () => {
    const memory = (id: string, projectId: string | null): MemoryRecord => ({
      id,
      user_id: id === "other-user" ? "user-2" : "user-1",
      content: "React authentication uses JWT",
      category: "project",
      pinned: false,
      confidence: 0.9,
      source: "manual",
      embedding: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      project_id: projectId,
    });

    const memories = [
      memory("global", null),
      memory("project-one", "project-1"),
      memory("project-two", "project-2"),
      memory("other-user", null),
    ];
    const inProject = await retrieveMemories("React authentication", memories, {
      lightweight: true,
      userId: "user-1",
      projectId: "project-1",
    });
    const outsideProject = await retrieveMemories("React authentication", memories, {
      lightweight: true,
      userId: "user-1",
    });

    expect(inProject.map(({ memory: item }) => item.id).sort()).toEqual([
      "global",
      "project-one",
    ]);
    expect(outsideProject.map(({ memory: item }) => item.id)).toEqual(["global"]);
  });

  it("uses keyword fallback when embedding generation fails and rejects secret records", async () => {
    const record: MemoryRecord = {
      id: "auth",
      user_id: "user-1",
      content: "The project uses JWT authentication",
      category: "project",
      pinned: false,
      confidence: 1,
      source: "manual",
      embedding: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const secret = { ...record, id: "secret", content: "My password is hunter2" };

    const result = await retrieveMemories("JWT authentication", [record, secret]);

    expect(result.map(({ memory }) => memory.id)).toEqual(["auth"]);
  });

  it("recognizes repeated facts as duplicates and distinguishes corrections", () => {
    expect(arePossibleDuplicates("I prefer TypeScript", "I prefer TypeScript!")).toBe(true);
    expect(arePossibleDuplicates("I prefer TypeScript", "I do not prefer TypeScript")).toBe(
      false,
    );
  });
});
