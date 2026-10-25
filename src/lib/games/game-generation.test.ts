import { describe, expect, it, vi } from "vitest";
import { planGameSpec, GAME_PLANNER_SYSTEM } from "./game-generation";
import {
  createGameRecord,
  updateGameGeneration,
  type GameDatabase,
  type GameRecordQuery,
  type PersistedGame,
} from "./game-service";
import { createGameHtml, getRendererName } from "./game-runtime";
import type { GameSpec, GameType } from "./game-runtime";

const mechanics: Record<GameSpec["gameType"], object> = {
  runner: { obstacleDensity: 1, collectibleDensity: 1, jumpHeight: 1, finishDistance: 160 },
  rally: { fuelCapacity: 100, fuelDrain: .4, rockDensity: 1, fuelPickupRate: 1, finishDistance: 160 },
  platformer: { platformCount: 8, hazardCount: 3, collectibleCount: 5 },
  shooter: { fireRate: .3, enemyDensity: 1, playerSpeed: 4, targetKills: 12 },
  puzzle: { gridSize: 6, colorCount: 4, matchLength: 3, targetMatches: 6 },
};
function spec(gameType: GameSpec["gameType"]): GameSpec {
  return {
    schemaVersion: 2, title: `${gameType} game`, description: `Playable ${gameType}`,
    gameType, theme: "prompt-specific world", player: gameType === "rally" ? "vehicle" : "hero",
    world: "a world based on the full prompt", difficulty: "normal", objective: "Complete the goal",
    controls: ["Controls for this game"], visualStyle: "bright pixel art", winCondition: "Reach target",
    loseCondition: "Lose condition", seed: 22, mechanics: mechanics[gameType],
  } as GameSpec;
}
const prompts: Array<[string, GameSpec["gameType"]]> = [
  ["A neon endless runner through Mumbai at night, jumping over traffic and collecting coins", "runner"],
  ["A desert rally where I steer around rocks and manage scarce fuel pickups", "rally"],
  ["Escape a jungle temple by jumping between platforms, avoiding traps and reaching treasure", "platformer"],
  ["Fly a spacecraft, shoot hostile asteroids and collect stars", "shooter"],
  ["Connect matching colored tiles with adjacent swaps to solve the board", "puzzle"],
];

describe("AI game planning contract", () => {
  it.each(prompts)("validates the model's distinct %s gameplay plan", async (prompt, gameType) => {
    const invoke = vi.fn(async (system: string, userPrompt: string) => {
      expect(system).toBe(GAME_PLANNER_SYSTEM);
      expect(userPrompt).toContain(prompt);
      return JSON.stringify(spec(gameType));
    });
    const result = await planGameSpec({ prompt, difficulty: "normal", generate: invoke });
    expect(result.gameType).toBe(gameType);
    expect(result.mechanics).toEqual(mechanics[gameType]);
  });

  it("passes the whole current spec to customization and accepts real mechanics changes", async () => {
    const current = spec("rally");
    const changed = { ...current, mechanics: { ...current.mechanics, rockDensity: 1.8, fuelDrain: .7 } };
    let sentPrompt = "";
    const result = await planGameSpec({
      prompt: "",
      difficulty: "normal",
      existing: current,
      instruction: "Add more rocks and make fuel scarcer",
      generate: async (_system, prompt) => { sentPrompt = prompt; return JSON.stringify(changed); },
    });
    expect(sentPrompt).toContain(JSON.stringify(current));
    expect(result.gameType).toBe("rally");
    expect(result.mechanics).toMatchObject({ rockDensity: 1.8, fuelDrain: .7 });
  });

  it("applies only requested sections and retains unrelated generated changes", async () => {
    const current = spec("rally");
    const modelOutput = { ...current, theme: "unrequested theme", world: "unrequested world", mechanics: { ...current.mechanics, fuelDrain: .8 } };
    const result = await planGameSpec({
      prompt: "",
      difficulty: "normal",
      existing: current,
      instruction: "Make fuel scarcer",
      generate: async () => modelOutput,
    });
    expect(result.theme).toBe(current.theme);
    expect(result.world).toBe(current.world);
    expect(result.mechanics).toMatchObject({ fuelDrain: 0.8 });
  });

  it("rejects vague customization requests that do not identify a section", async () => {
    const current = spec("rally");
    await expect(planGameSpec({
      prompt: "",
      difficulty: "normal",
      existing: current,
      instruction: "Do something",
      generate: async () => current,
    })).rejects.toMatchObject({ kind: "unsupported" });
  });

  it("preserves the current game type unless a genre change is explicit", async () => {
    const current = spec("rally");
    await expect(planGameSpec({
      prompt: "", difficulty: "normal", existing: current, instruction: "Make fuel scarcer",
      generate: async () => JSON.stringify(spec("runner")),
    })).rejects.toThrow(/changed the game type without being asked/i);
    const changed = await planGameSpec({
      prompt: "", difficulty: "normal", existing: current, instruction: "Switch this to a puzzle game",
      generate: async () => JSON.stringify(spec("puzzle")),
    });
    expect(changed.gameType).toBe("puzzle");
  });

  it("rejects unsupported or invalid model output instead of falling back to a runner", async () => {
    await expect(planGameSpec({
      prompt: "A first-person immersive 3D exploration game", difficulty: "normal",
      generate: async () => JSON.stringify({ unsupported: true, message: "3D first-person play is not supported; try platformer or shooter." }),
    })).rejects.toMatchObject({ kind: "unsupported" });
    await expect(planGameSpec({
      prompt: "A space shooter", difficulty: "normal",
      generate: async () => JSON.stringify({ ...spec("shooter"), gameType: "runner" }),
    })).rejects.toThrow(/invalid or unsupported specification/i);
  });

  it("propagates provider errors without fabricating a successful specification", async () => {
    const providerError = new Error("provider failed");
    await expect(planGameSpec({
      prompt: prompts[1][0], difficulty: "normal", generate: async () => { throw providerError; },
    })).rejects.toBe(providerError);
  });
});

describe("Create Game generation-to-preview trace", () => {
  it.each(prompts)(
    "persists and dispatches %s as its generated genre",
    async (prompt, expectedType) => {
      let row: PersistedGame | null = null;
      const query: GameRecordQuery = {
        insert(values) {
          row = {
            ...values,
            id: "trace-game-id",
            prompt,
            spec: null,
            versions: [],
            status: "pending",
            created_at: "now",
            updated_at: "now",
          } as PersistedGame;
          return query;
        },
        update(values) {
          if (!row) throw new Error("Game record must exist before it can be updated.");
          row = { ...row, ...values, updated_at: "later" } as PersistedGame;
          return query;
        },
        select() {
          return query;
        },
        eq() {
          return query;
        },
        async single() {
          return { data: row, error: null };
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
        order() {
          return query;
        },
        async limit() {
          return { data: row ? [row] : [], error: null };
        },
      };
      const db: GameDatabase = { from: () => query };
      const created = await createGameRecord(db, { userId: "trace-user", prompt });
      await updateGameGeneration(db, "trace-user", created.id, { status: "generating" });
      const generated = await planGameSpec({
        prompt,
        difficulty: "normal",
        generate: async () => spec(expectedType),
      });
      const saved = await updateGameGeneration(db, "trace-user", created.id, {
        status: "ready",
        spec: generated,
      });
      expect(saved.spec?.schemaVersion).toBe(2);
      const savedSpec = saved.spec as GameSpec;
      const receivedByRenderer = savedSpec.gameType;
      const actualRenderer = getRendererName(savedSpec);

      expect(generated.gameType).toBe(expectedType);
      expect(savedSpec.gameType).toBe(expectedType);
      expect(receivedByRenderer).toBe(expectedType);
      expect(actualRenderer).toBe(expectedType);
      const html = createGameHtml(savedSpec);
      expect(html).toContain(`ENGINE="${expectedType}"`);
      const rendererByType: Record<GameType, string> = {
        runner: "tickRunner",
        rally: "tickRally",
        platformer: "tickPlatformer",
        shooter: "tickShooter",
        puzzle: "drawPuzzle",
        adventure: "three-adventure",
        racing: "tickRally",
        exploration: "three-exploration",
        fighting: "three-fighting",
      };
      expect(html).toContain(`function ${rendererByType[expectedType]}`);
    },
  );
});
