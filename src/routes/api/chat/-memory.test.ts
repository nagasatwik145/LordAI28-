import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const brain = vi.hoisted(() => ({ buildBrainContext: vi.fn() }));

vi.mock("@/lib/brain/context", () => ({
  buildBrainContext: brain.buildBrainContext,
}));

import { buildMemoryPrompt } from "./-memory";

function makeClient(
  memoryEnabled: boolean,
  personalizationEnabled = true,
  error: { message: string } | null = null,
) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { memory_enabled: memoryEnabled, personalization_enabled: personalizationEnabled },
    error,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    from,
  };
}

describe("chat memory prompt", () => {
  beforeEach(() => {
    brain.buildBrainContext.mockReset();
    brain.buildBrainContext.mockResolvedValue({ systemPromptSnippet: "Relevant project memory" });
  });

  it("does not retrieve or inject memory when the user disabled memory", async () => {
    const { client } = makeClient(false);

    await expect(buildMemoryPrompt(client, "user-1", "continue auth")).resolves.toBe("");
    expect(brain.buildBrainContext).not.toHaveBeenCalled();
  });

  it("fails closed when memory settings cannot be read", async () => {
    const { client } = makeClient(true, true, { message: "settings unavailable" });

    await expect(buildMemoryPrompt(client, "user-1", "continue auth")).resolves.toBe("");
    expect(brain.buildBrainContext).not.toHaveBeenCalled();
  });

  it("does not retrieve memory when personalization is paused", async () => {
    const { client } = makeClient(true, false);

    await expect(buildMemoryPrompt(client, "user-1", "continue auth")).resolves.toBe("");
    expect(brain.buildBrainContext).not.toHaveBeenCalled();
  });

  it("fails closed with an empty deterministic context when retrieval fails", async () => {
    brain.buildBrainContext.mockRejectedValue(new Error("memory provider unavailable"));
    const { client } = makeClient(true);

    await expect(buildMemoryPrompt(client, "user-1", "continue auth")).resolves.toBe("");
  });

  it("uses the authenticated client to retrieve relevant context", async () => {
    const { client } = makeClient(true);

    await expect(buildMemoryPrompt(client, "user-1", "continue auth")).resolves.toBe(
      "Relevant project memory",
    );
    expect(brain.buildBrainContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", query: "continue auth" }),
      client,
    );
  });
});
