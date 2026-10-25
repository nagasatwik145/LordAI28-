import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createGameZip } from "./game-export";
import { Game3DSpecSchema, parseGame3DSpecForPreview, type Game3DSpec } from "./game-spec-3d";
import { getRendererName, validateGameSpec } from "./game-runtime";
import { classifyGameIntent, planGameSpec } from "./game-generation";
import * as THREE from "three";
import {
  getEnvironmentAssetCount,
  getQualityPixelRatio,
  getVisualPalette,
} from "./engines/3d/runtime";
import { THREE_D_CONTROLS } from "./game-controls-3d";
import { evaluateThreeGameOutcome } from "./engines/3d/progression";

const base = {
  schemaVersion: 3 as const,
  dimension: "3d" as const,
  title: "Neon Lane Run",
  description: "A three dimensional lane runner.",
  theme: "nighttime neon city",
  visualStyle: "Low poly, bright signs, reflective road",
  world: "A three lane road through a futuristic city",
  player: "A low-poly courier",
  objective: "Dodge barriers and collect coins to reach the finish.",
  camera: { fov: 62, followDistance: 10, height: 4 },
  lighting: { ambient: 0.5, directional: 1.2, fogDistance: 150 },
  controls: ["A/D or left/right to switch lanes", "Space or tap Jump"],
  obstacles: [{ kind: "barrier" as const, lane: 1, distance: 50 }],
  enemies: [],
  collectibles: [{ kind: "coin" as const, lane: 0, distance: 36 }],
  objectives: ["Avoid barriers", "Reach the finish"],
  levels: [{ name: "Neon Boulevard", distance: 180, speedScale: 1 }],
  difficulty: "normal" as const,
  winCondition: "Reach the finish distance.",
  loseCondition: "Collide with an obstacle.",
  seed: 42,
  palette: "neon" as const,
};
const runner: Game3DSpec = Game3DSpecSchema.parse({
  ...base,
  gameType: "runner",
  mechanics: { laneCount: 3, jumpHeight: 2, speed: 10, finishDistance: 180 },
});

describe("Three.js game specifications and exports", () => {
  it.each([
    ["runner", { laneCount: 3, jumpHeight: 2, speed: 10, finishDistance: 180 }, "jump"],
    [
      "rally",
      { fuelCapacity: 100, fuelDrain: 0.3, acceleration: 10, finishDistance: 180 },
      "accelerate",
    ],
    [
      "racing",
      { fuelCapacity: 100, fuelDrain: 0.3, acceleration: 10, finishDistance: 180 },
      "accelerate",
    ],
    ["shooter", { fireRate: 0.3, playerSpeed: 6, health: 3, targetKills: 5 }, "fire"],
    [
      "adventure",
      { playerSpeed: 4, jumpHeight: 2, collectibleGoal: 2, finishDistance: 180 },
      "jump",
    ],
    [
      "exploration",
      { playerSpeed: 4, jumpHeight: 2, collectibleGoal: 2, finishDistance: 180 },
      "jump",
    ],
    [
      "platformer",
      { playerSpeed: 4, jumpHeight: 2, collectibleGoal: 2, finishDistance: 180 },
      "jump",
    ],
    [
      "fighting",
      {
        playerHealth: 120,
        enemyHealth: 70,
        enemyCount: 2,
        battleCount: 2,
        comboTarget: 8,
        suitUnlockEvery: 1,
        punchDamage: 18,
        kickDamage: 28,
        webDamage: 12,
      },
      "punch",
    ],
  ] as const)(
    "supports %s controls, progress, collision loss, and a concrete win condition",
    (gameType, mechanics, expectedAction) => {
      const input = {
        ...base,
        gameType,
        mechanics,
        ...(gameType === "fighting"
          ? {
              suits: [
                { name: "First", description: "Original first suit", accent: "crimson" },
                { name: "Second", description: "Original second suit", accent: "cyan" },
              ],
            }
          : {}),
      };
      const spec = Game3DSpecSchema.parse(input);
      const controls = THREE_D_CONTROLS[gameType];
      expect([...controls.movement, ...controls.actions]).toContain(expectedAction);
      const running = { distance: 0, health: 1, fuel: 50, kills: 0, collectibles: 0, victories: 0 };
      expect(evaluateThreeGameOutcome(spec, running)).toBe("playing");
      expect(evaluateThreeGameOutcome(spec, { ...running, health: 0 })).toBe("failed");

      const win = { ...running };
      if (gameType === "runner" || gameType === "rally" || gameType === "racing")
        win.distance = mechanics.finishDistance;
      else if (gameType === "shooter") win.kills = mechanics.targetKills;
      else if (gameType === "fighting") win.victories = mechanics.battleCount;
      else win.collectibles = mechanics.collectibleGoal;
      expect(evaluateThreeGameOutcome(spec, win)).toBe("completed");

      if (gameType === "rally" || gameType === "racing")
        expect(evaluateThreeGameOutcome(spec, { ...running, fuel: 0 })).toBe("failed");
    },
  );

  it("has mapped touch controls for every supported 3D genre", () => {
    expect(Object.keys(THREE_D_CONTROLS).sort()).toEqual([
      "adventure",
      "exploration",
      "fighting",
      "platformer",
      "racing",
      "rally",
      "runner",
      "shooter",
    ]);
    expect(THREE_D_CONTROLS.racing.actions).toContain("accelerate");
    expect(THREE_D_CONTROLS.fighting.actions).toEqual(["punch", "kick", "dodge", "web"]);
    expect(THREE_D_CONTROLS.shooter.movement).toContain("down");
  });

  it("validates and applies structured controller, physics, scoring, sound, and responsive UI settings", () => {
    const configured = Game3DSpecSchema.parse({
      ...runner,
      gameType: "runner",
      playerController: "auto",
      physics: { gravity: 12, friction: 0.35, collisionRadius: 0.7 },
      materialStyle: "metallic",
      scoring: { distancePoints: 3, collectiblePoints: 75, enemyPoints: 125 },
      health: 2,
      audio: { enabled: true, volume: 0.3 },
      ui: { touchControls: false, hudScale: 1.1 },
    });
    expect(configured).toMatchObject({
      playerController: "lane-runner",
      physics: { gravity: 12, friction: 0.35, collisionRadius: 0.7 },
      materialStyle: "metallic",
      scoring: { distancePoints: 3, collectiblePoints: 75, enemyPoints: 125 },
      health: 2,
      audio: { enabled: true, volume: 0.3 },
      ui: { touchControls: false, hudScale: 1.1 },
    });
    expect(
      Game3DSpecSchema.safeParse({
        ...runner,
        physics: { gravity: 100, friction: 0.2, collisionRadius: 0.8 },
      }).success,
    ).toBe(false);
    expect(
      Game3DSpecSchema.safeParse({ ...runner, audio: { enabled: true, volume: 2 } }).success,
    ).toBe(false);
  });

  it("caps mobile rendering cost and pixel ratio by the selected quality level", () => {
    expect(getQualityPixelRatio(3, "low")).toBe(1);
    expect(getQualityPixelRatio(3, "medium")).toBe(1.25);
    expect(getQualityPixelRatio(1, "high")).toBe(1);
    expect(getQualityPixelRatio(Number.NaN, "high")).toBe(1);
    expect(getEnvironmentAssetCount(5, "city", "low")).toBeLessThanOrEqual(36);
    expect(getEnvironmentAssetCount(5, "space-nebula", "medium")).toBeLessThanOrEqual(72);
    expect(getEnvironmentAssetCount(5, "city", "high")).toBe(86);
  });

  it("exports the supported genre's mapped controls instead of assuming a partial genre list", async () => {
    const zip = await createGameZip(runner, "A neon lane runner", "export-runtime");
    const archive = await JSZip.loadAsync(zip);
    const html = await archive.file("index.html")!.async("text");
    expect(html).toContain('"runner":{"movement":["left","right"],"actions":["jump"]}');
    expect(html).toContain("async function startGame()");
    expect(html).toContain("Automated gameplay test: not run");
  });

  it("normalizes an old saved v3 spec before visual palette selection", () => {
    const oldSaved = { ...runner } as Record<string, unknown>;
    delete oldSaved.environmentPreset;
    delete oldSaved.timeOfDay;
    delete oldSaved.lightingPreset;
    const visuals = getVisualPalette(THREE, oldSaved as unknown as Game3DSpec);
    expect(visuals.key).toBeTypeOf("number");
    expect(Number.isFinite(visuals.key)).toBe(true);
  });

  it("assigns unique entity keys when saved or generated data omits or duplicates keys", () => {
    const oldSaved = structuredClone(runner) as Game3DSpec;
    for (const item of [...oldSaved.obstacles, ...oldSaved.enemies, ...oldSaved.collectibles])
      delete (item as { key?: string }).key;
    delete (oldSaved as Partial<Game3DSpec>).environmentPreset;
    const normalized = Game3DSpecSchema.parse(oldSaved);
    const keys = [...normalized.obstacles, ...normalized.enemies, ...normalized.collectibles].map(
      (item) => item.key,
    );
    expect(keys.every((key) => typeof key === "string" && key.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(normalized.environmentPreset).toBe("city");

    const duplicate = Game3DSpecSchema.parse({
      ...runner,
      enemies: [{ ...runner.obstacles[0], kind: "drone" }],
    });
    expect(duplicate.enemies[0].key).not.toBe(duplicate.obstacles[0].key);
  });

  it("rejects missing required collections and undefined entity entries instead of sending them to Three.js", () => {
    expect(Game3DSpecSchema.safeParse({ ...runner, obstacles: [undefined] }).success).toBe(false);
    const missing = { ...runner } as Record<string, unknown>;
    delete missing.enemies;
    expect(Game3DSpecSchema.safeParse(missing).success).toBe(false);
    expect(
      Game3DSpecSchema.safeParse({
        ...runner,
        mechanics: { ...runner.mechanics, fireRate: "fast" },
      }).success,
    ).toBe(false);
  });

  it("returns a friendly invalid-preview state for malformed saved data", () => {
    const invalid = parseGame3DSpecForPreview({ ...runner, enemies: [undefined] });
    expect(invalid).toHaveProperty(
      "error",
      expect.stringContaining("incomplete or invalid 3D data"),
    );
  });

  it("rejects malformed AI specifications with undefined entities without fabricating a game", async () => {
    await expect(
      planGameSpec({
        prompt: "Starlight Squadron 3D space shooter",
        dimension: "3d",
        difficulty: "normal",
        generate: async () => ({ ...runner, gameType: "shooter", enemies: [undefined] }),
      }),
    ).rejects.toThrow(/invalid or unsupported specification/i);
  });

  it("validates allowlisted 3D gameplay and selects the Three.js engine", () => {
    expect(Game3DSpecSchema.safeParse(runner).success).toBe(true);
    expect(validateGameSpec(runner)).toBe(true);
    expect(getRendererName(runner)).toBe("three-runner");
    expect(Game3DSpecSchema.safeParse({ ...runner, palette: "external-image-url" }).success).toBe(
      false,
    );
    expect(
      Game3DSpecSchema.safeParse({
        ...runner,
        obstacles: Array.from({ length: 25 }, () => base.obstacles[0]),
      }).success,
    ).toBe(false);
  });

  it("keeps old v3 saves compatible and validates AI-selected visual themes", () => {
    const legacySaved = Game3DSpecSchema.parse(runner);
    expect(legacySaved.environmentPreset).toBe("city");
    expect(legacySaved.assetDensity).toBe(3);
    expect(legacySaved).toMatchObject({
      playerController: "lane-runner",
      physics: { gravity: 10, friction: 0.28, collisionRadius: 0.8 },
      scoring: { distancePoints: 2, collectiblePoints: 50, enemyPoints: 100 },
      audio: { enabled: false, volume: 0.45 },
      ui: { touchControls: true, hudScale: 1 },
    });
    const themed = Game3DSpecSchema.parse({
      ...runner,
      environmentPreset: "desert-dunes",
      timeOfDay: "sunset",
      terrainStyle: "sand",
      architectureStyle: "none",
      vegetationStyle: "cacti",
      lightingPreset: "golden-hour",
      atmosphere: "dust",
      assetDensity: 5,
      particleIntensity: 0.8,
    });
    expect(themed).toMatchObject({
      environmentPreset: "desert-dunes",
      timeOfDay: "sunset",
      terrainStyle: "sand",
      vegetationStyle: "cacti",
      atmosphere: "dust",
      assetDensity: 5,
    });
    expect(
      Game3DSpecSchema.safeParse({ ...themed, environmentPreset: "remote-texture-url" }).success,
    ).toBe(false);
  });

  it.each([
    ["Make a 3D endless runner", runner, "runner"],
    [
      "Create a 3D desert rally",
      {
        ...base,
        gameType: "rally",
        mechanics: { fuelCapacity: 100, fuelDrain: 0.3, acceleration: 10, finishDistance: 300 },
      },
      "rally",
    ],
    [
      "Create Starlight Squadron, a 3D space shooter",
      {
        ...base,
        environmentPreset: "space-nebula",
        timeOfDay: "deep-space",
        terrainStyle: "asteroid-field",
        architectureStyle: "sci-fi",
        lightingPreset: "deep-space",
        atmosphere: "nebula",
        gameType: "shooter",
        enemies: Array.from({ length: 8 }, (_, i) => ({
          kind: "drone",
          lane: (i % 3) - 1,
          distance: 30 + i * 20,
        })),
        mechanics: { fireRate: 0.3, playerSpeed: 6, health: 3, targetKills: 8 },
      },
      "shooter",
    ],
    [
      "Create a 3D jungle adventure",
      {
        ...base,
        gameType: "adventure",
        mechanics: { playerSpeed: 4, jumpHeight: 2, collectibleGoal: 1, finishDistance: 240 },
      },
      "adventure",
    ],
  ] as const)("validates a generated 3D prompt for %s", async (prompt, generated, gameType) => {
    const result = await planGameSpec({
      prompt,
      dimension: "3d",
      difficulty: "normal",
      generate: async () => generated,
    });
    expect(result.schemaVersion).toBe(3);
    expect(result.gameType).toBe(gameType);
    expect(getRendererName(result)).toBe(`three-${gameType}`);
    if (prompt.includes("Starlight Squadron") && result.schemaVersion === 3)
      expect(result.environmentPreset).toBe("space-nebula");
  });

  it("carries prompt-specific environment selection through AI validation", async () => {
    const result = await planGameSpec({
      prompt: "A cinematic desert rally at golden hour",
      dimension: "3d",
      difficulty: "normal",
      generate: async () => ({
        ...base,
        environmentPreset: "desert-dunes",
        timeOfDay: "sunset",
        terrainStyle: "sand",
        vegetationStyle: "cacti",
        lightingPreset: "golden-hour",
        atmosphere: "dust",
        gameType: "rally",
        mechanics: { fuelCapacity: 100, fuelDrain: 0.3, acceleration: 10, finishDistance: 300 },
      }),
    });
    expect(result).toMatchObject({
      environmentPreset: "desert-dunes",
      timeOfDay: "sunset",
      terrainStyle: "sand",
      vegetationStyle: "cacti",
      lightingPreset: "golden-hour",
      atmosphere: "dust",
    });
  });

  it("preserves the exact spider fighting prompt, corrects suites to suits, and retries a shooter response", async () => {
    const prompt =
      "create a spiderman fighting game with multiple spider suites unlock after 3 fights";
    const shooter = {
      ...base,
      gameType: "shooter",
      enemies: [{ kind: "drone", lane: 0, distance: 40 }],
      mechanics: { fireRate: 0.3, playerSpeed: 6, health: 3, targetKills: 8 },
    };
    const fighting = {
      ...base,
      gameType: "fighting",
      title: "Web Warden: Rooftop Trials",
      player: "Spider-Man",
      objective: "Win three fights to unlock original suits.",
      controls: ["A/D move", "J punch", "K kick", "Space dodge", "L web strike"],
      suits: [
        { name: "Threadguard", description: "Balanced original suit", accent: "crimson" },
        { name: "Pulseweave", description: "Quick energy suit", accent: "cyan" },
        { name: "Sunspider", description: "Heavy golden suit", accent: "gold" },
      ],
      // Intentionally contradict both the prompt cadence and requested progression length.
      mechanics: {
        playerHealth: 120,
        enemyHealth: 70,
        enemyCount: 3,
        battleCount: 1,
        comboTarget: 8,
        suitUnlockEvery: 1,
        punchDamage: 18,
        kickDamage: 28,
        webDamage: 12,
      },
    };
    const prompts: string[] = [];
    const result = await planGameSpec({
      prompt,
      difficulty: "normal",
      generate: async (_system, request) => {
        prompts.push(request);
        return prompts.length === 1 ? shooter : fighting;
      },
    });
    expect(classifyGameIntent(prompt)).toBe("fighting");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("spider suits unlock after 3 fights");
    expect(prompts[1]).toContain('gameType exactly "fighting"');
    expect(result.schemaVersion).toBe(3);
    expect(result.gameType).toBe("fighting");
    expect(getRendererName(result)).toBe("three-fighting");
    if (result.schemaVersion === 3 && result.gameType === "fighting") {
      expect(result.mechanics).toMatchObject({ battleCount: 3, suitUnlockEvery: 3, enemyCount: 3 });
      expect(result.suits).toHaveLength(3);
      expect(result.player).toBe("Original spider-themed hero");
      expect(new Set(result.suits.map((suit) => suit.key)).size).toBe(3);
      expect(result.controls).toEqual(
        expect.arrayContaining(["J punch", "K kick", "Space dodge", "L web strike"]),
      );
    }
  });

  it.each([
    ["endless runner with jumps", "runner"],
    ["3D car racing game", "racing"],
    ["3D platformer with jumping", "platformer"],
    ["3D exploration game in ancient ruins", "exploration"],
    ["3D space shooter", "shooter"],
    ["3D superhero fighting game", "fighting"],
  ] as const)("distinguishes requested genre intent for %s", (prompt, expected) => {
    expect(classifyGameIntent(prompt)).toBe(expected);
  });

  it.each([
    [{ ...base, gameType: "runner", mechanics: runner.mechanics }, "three-runner"],
    [
      {
        ...base,
        gameType: "rally",
        mechanics: { fuelCapacity: 100, fuelDrain: 0.3, acceleration: 10, finishDistance: 300 },
      },
      "three-rally",
    ],
    [
      {
        ...base,
        gameType: "shooter",
        enemies: Array.from({ length: 8 }, (_, i) => ({
          kind: "drone",
          lane: (i % 3) - 1,
          distance: 30 + i * 20,
        })),
        mechanics: { fireRate: 0.3, playerSpeed: 6, health: 3, targetKills: 8 },
      },
      "three-shooter",
    ],
    [
      {
        ...base,
        gameType: "adventure",
        mechanics: { playerSpeed: 4, jumpHeight: 2, collectibleGoal: 1, finishDistance: 240 },
      },
      "three-adventure",
    ],
  ] as const)("dispatches a 3D %s spec to its own Three.js renderer", (spec, engine) => {
    expect(Game3DSpecSchema.parse(spec).gameType).toBe(spec.gameType);
    expect(getRendererName(Game3DSpecSchema.parse(spec))).toBe(engine);
  });

  it("packages the validated 3D spec and the local Three.js runtime without remote scripts", async () => {
    const zip = await JSZip.loadAsync(
      await createGameZip(runner, "3D neon runner", "exported Three.js runtime bundle"),
    );
    expect(await zip.file("three-runtime.js")?.async("string")).toBe(
      "exported Three.js runtime bundle",
    );
    const html = await zip.file("index.html")?.async("string");
    expect(html).toContain("./three-runtime.js");
    expect(html).toContain('type="module"');
    expect(html).not.toContain("https://");
    const metadata = JSON.parse((await zip.file("game.json")?.async("string")) ?? "{}");
    expect(metadata).toMatchObject({
      dimension: "3d",
      gameType: "runner",
      mechanics: runner.mechanics,
      engine: "LORD Three.js 3D runner",
    });
  });

  it("normalizes older saved v3 data while exporting it", async () => {
    const oldSaved = structuredClone(runner) as Record<string, unknown>;
    for (const item of [
      ...(oldSaved.obstacles as Array<Record<string, unknown>>),
      ...(oldSaved.collectibles as Array<Record<string, unknown>>),
    ])
      delete item.key;
    delete oldSaved.environmentPreset;
    delete oldSaved.timeOfDay;
    const zip = await JSZip.loadAsync(
      await createGameZip(oldSaved as unknown as Game3DSpec, "old saved prompt", "local runtime"),
    );
    const metadata = JSON.parse((await zip.file("game.json")?.async("string")) ?? "{}");
    expect(metadata.environmentPreset).toBe("city");
    expect(metadata.obstacles[0].key).toBeTruthy();
    expect(metadata.collectibles[0].key).toBeTruthy();
  });
});
