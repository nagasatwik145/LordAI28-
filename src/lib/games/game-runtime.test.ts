import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createGameZip } from "./game-export";
import { createGameHtml, gameTypeOf, getRendererName, GameSpecSchema, type GameSpec, type LegacyGameSpec } from "./game-runtime";

const common = {
  schemaVersion: 2 as const,
  title: "Test Game",
  description: "A playable test game.",
  theme: "test world",
  player: "the player",
  world: "a changing world",
  difficulty: "normal" as const,
  objective: "Complete the level.",
  controls: ["Arrow keys", "Touch"],
  visualStyle: "bright pixel art",
  winCondition: "Reach the goal.",
  loseCondition: "Lose all fuel or collide.",
  seed: 17,
};
const specs: GameSpec[] = [
  { ...common, gameType: "runner", mechanics: { obstacleDensity: 1, collectibleDensity: 1, jumpHeight: 1, finishDistance: 160 } },
  { ...common, gameType: "rally", mechanics: { fuelCapacity: 100, fuelDrain: .4, rockDensity: 1, fuelPickupRate: 1, finishDistance: 160 } },
  { ...common, gameType: "platformer", mechanics: { platformCount: 8, hazardCount: 3, collectibleCount: 5 } },
  { ...common, gameType: "shooter", mechanics: { fireRate: .3, enemyDensity: 1, playerSpeed: 4, targetKills: 12 } },
  { ...common, gameType: "puzzle", mechanics: { gridSize: 6, colorCount: 4, matchLength: 3, targetMatches: 6 } },
];

describe("genre-specific deterministic game runtime", () => {
  it("validates each supported mechanics schema and rejects unsupported types/configurations", () => {
    for (const spec of specs) expect(GameSpecSchema.safeParse(spec).success).toBe(true);
    expect(GameSpecSchema.safeParse({ ...specs[0], gameType: "unsupported" }).success).toBe(false);
    expect(GameSpecSchema.safeParse({ ...specs[1], mechanics: { fuelCapacity: 400 } }).success).toBe(false);
  });

  it("dispatches previews to five separate gameplay engines with their mechanic inputs", () => {
    const renderers = ["tickRunner", "tickRally", "tickPlatformer", "tickShooter", "drawPuzzle"];
    for (const [index, spec] of specs.entries()) {
      const html = createGameHtml(spec);
      const renderer = renderers[index];
      expect(getRendererName(spec)).toBe(spec.gameType);
      expect(html).toContain(`ENGINE="${spec.gameType}"`);
      if (spec.gameType === "runner") expect(html).toContain("default:tickRunner(dt)");
      else expect(html).toContain(`case'${spec.gameType}':`);
      expect(html).toContain(`function ${renderer}`);
      const htmlForSpec = createGameHtml(spec);
      const script = htmlForSpec.match(/<script>([\s\S]*)<\/script>/)?.[1];
      expect(script).toBeTruthy();
      expect(() => new Function(script!)).not.toThrow();
      expect(htmlForSpec).not.toMatch(/<script[^>]+src=/i);
    }
  });

  it("uses rally steering, fuel consumption and pickups, and shooter movement, firing and kill goals", () => {
    const rally = createGameHtml(specs[1]);
    const shooter = createGameHtml(specs[3]);
    expect(rally).toContain("p.car=Math.max");
    expect(rally).toContain("p.fuel-=G.mechanics.fuelDrain*dt");
    expect(rally).toContain("p.fuel+24");
    expect(rally).toContain("Out of fuel");
    expect(shooter).toContain("G.mechanics.fireRate*1000");
    expect(shooter).toContain("p.shots.push");
    expect(shooter).toContain("p.kills++");
    expect(shooter).toContain("G.mechanics.targetKills");
  });

  it("keeps legacy saved games playable as their historical runner type", async () => {
    const old: LegacyGameSpec = {
      schemaVersion: 1, title: "Old Runner", description: "Original saved game", genre: "dodge",
      theme: "old city", difficulty: "easy", objective: "Avoid obstacles", controls: ["Space"], seed: 9,
    };
    expect(gameTypeOf(old)).toBe("runner");
    expect(createGameHtml(old)).toContain("tickRunner");
    const blob = await createGameZip(old, "old saved prompt");
    const archive = await JSZip.loadAsync(blob);
    const metadata = JSON.parse((await archive.file("game.json")?.async("string")) ?? "{}");
    expect(metadata).toMatchObject({ title: "Old Runner", originalPrompt: "old saved prompt" });
    expect(metadata.engine).toContain("runner");
  });

  it("exports the actual v2 genre and mechanics and restarts from a clean game state", async () => {
    const rally = specs[1];
    const archive = await JSZip.loadAsync(await createGameZip(rally, "fuel rally in a desert"));
    const metadata = JSON.parse((await archive.file("game.json")?.async("string")) ?? "{}");
    expect(metadata).toMatchObject({ gameType: "rally", mechanics: rally.mechanics });
    const html = await archive.file("index.html")?.async("string");
    expect(html).toContain("function tickRally");
    expect(html).toContain("function start()");
    expect(html).toContain("state=initialState()");
  });
});
