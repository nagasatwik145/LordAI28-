import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  useMutation: vi.fn((options: unknown) => options),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  embed: vi.fn(),
  createClientTag: vi.fn(),
  markClientTagSent: vi.fn(),
  invalidateBrainContextCache: vi.fn(),
  eqCalls: vi.fn(),
  isCalls: vi.fn(),
  insertCalls: vi.fn(),
  updateCalls: vi.fn(),
  deleteCalls: vi.fn(),
  existingRows: [] as Array<Record<string, unknown>>,
  insertedRow: null as Record<string, unknown> | null,
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: state.useMutation,
  useQuery: state.useQuery,
  useQueryClient: state.useQueryClient,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: state.from },
}));

vi.mock("./embeddings", () => ({ embed: state.embed }));
vi.mock("@/lib/realtime/client-tag", () => ({
  createClientTag: state.createClientTag,
  markClientTagSent: state.markClientTagSent,
}));
vi.mock("@/lib/brain/context-cache", () => ({
  invalidateBrainContextCache: state.invalidateBrainContextCache,
}));

import { useAddMemory, useClearMemories, useDeleteMemory, useUpdateMemory } from "./service";

type QueryResult = { data: Array<Record<string, unknown>>; error: null };
type QueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  then: (resolve: (result: QueryResult) => unknown) => unknown;
};

function makeBuilder(): QueryBuilder {
  const builder = {} as QueryBuilder;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((...args: unknown[]) => {
    state.eqCalls(...args);
    return builder;
  });
  builder.is = vi.fn((...args: unknown[]) => {
    state.isCalls(...args);
    return builder;
  });
  builder.order = vi.fn(() => builder);
  builder.insert = vi.fn((...args: unknown[]) => {
    state.insertCalls(...args);
    return builder;
  });
  builder.update = vi.fn((...args: unknown[]) => {
    state.updateCalls(...args);
    return builder;
  });
  builder.delete = vi.fn(() => {
    state.deleteCalls();
    return builder;
  });
  builder.single = vi.fn(async () => ({ data: state.insertedRow, error: null }));
  builder.then = (resolve) =>
    Promise.resolve({ data: state.existingRows, error: null }).then(resolve);
  return builder;
}

function getMutationOptions(): {
  mutationFn: (input?: unknown) => Promise<unknown>;
} {
  return state.useMutation.mock.results.at(-1)?.value as {
    mutationFn: (input?: unknown) => Promise<unknown>;
  };
}

const storedMemory = {
  id: "memory-1",
  user_id: "user-1",
  content: "I prefer TypeScript",
  category: "preference",
  pinned: false,
  confidence: 1,
  source: "manual",
  embedding: [0.25],
  expires_at: null,
  created_at: "2026-10-25T00:00:00.000Z",
  updated_at: "2026-10-25T00:00:00.000Z",
  project_id: null,
  source_conversation_id: null,
  confirmation_status: "confirmed",
  use_in_context: true,
  archived: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.existingRows = [];
  state.insertedRow = storedMemory;
  state.embed.mockResolvedValue({ vector: [0.25] });
  state.createClientTag.mockReturnValue("client-tag");
  state.useQueryClient.mockReturnValue({
    cancelQueries: vi.fn(),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  });
  state.from.mockImplementation(() => makeBuilder());
});

describe("memory persistence mutations", () => {
  it("creates a memory through the owner-scoped table and stores an embedding", async () => {
    useAddMemory("user-1");

    await getMutationOptions().mutationFn({
      content: "  I prefer TypeScript  ",
      category: "preference",
      source: "manual",
    });

    expect(state.from).toHaveBeenCalledWith("memories");
    expect(state.eqCalls).toHaveBeenCalledWith("user_id", "user-1");
    expect(state.isCalls).toHaveBeenCalledWith("project_id", null);
    expect(state.insertCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        content: "I prefer TypeScript",
        embedding: [0.25],
        confirmation_status: "confirmed",
        use_in_context: true,
      }),
    );
  });

  it("returns an existing equivalent memory rather than inserting a duplicate", async () => {
    state.existingRows = [storedMemory];
    useAddMemory("user-1");

    await expect(
      getMutationOptions().mutationFn({
        content: "I prefer TypeScript!",
        category: "preference",
        source: "manual",
      }),
    ).resolves.toMatchObject({ id: "memory-1" });

    expect(state.insertCalls).not.toHaveBeenCalled();
  });

  it("re-embeds corrected content and scopes correction to the owner", async () => {
    state.embed.mockResolvedValue({ vector: [0.75] });
    useUpdateMemory("user-1");

    await getMutationOptions().mutationFn({
      id: "memory-1",
      content: "I prefer Rust",
    });

    expect(state.updateCalls).toHaveBeenCalledWith(
      expect.objectContaining({ content: "I prefer Rust", embedding: [0.75] }),
    );
    expect(state.eqCalls).toHaveBeenCalledWith("id", "memory-1");
    expect(state.eqCalls).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("persists exclusion and deletion only for the authenticated owner", async () => {
    useUpdateMemory("user-1");
    await getMutationOptions().mutationFn({ id: "memory-1", useInContext: false });

    expect(state.updateCalls).toHaveBeenCalledWith(
      expect.objectContaining({ use_in_context: false }),
    );
    expect(state.eqCalls).toHaveBeenCalledWith("user_id", "user-1");

    useDeleteMemory("user-1");
    await getMutationOptions().mutationFn("memory-1");

    expect(state.deleteCalls).toHaveBeenCalled();
    expect(state.eqCalls).toHaveBeenCalledWith("id", "memory-1");
    expect(state.eqCalls).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("clears active memories with an owner filter", async () => {
    useClearMemories("user-1");
    await getMutationOptions().mutationFn();

    expect(state.deleteCalls).toHaveBeenCalled();
    expect(state.eqCalls).toHaveBeenCalledWith("user_id", "user-1");
  });
});
