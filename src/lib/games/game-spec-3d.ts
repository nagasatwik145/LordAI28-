import { z } from "zod";

const gameTypeSchema = z.enum([
  "runner",
  "rally",
  "racing",
  "shooter",
  "adventure",
  "exploration",
  "platformer",
  "fighting",
]);
const playerControllerSchema = z.enum([
  "auto",
  "lane-runner",
  "vehicle",
  "space-shooter",
  "third-person",
  "arena-fighter",
]);

const placement = z
  .object({
    key: z.string().trim().max(80).default(""),
    kind: z.enum(["barrier", "rock", "asteroid", "hazard", "platform"]),
    lane: z.number().int().min(-1).max(1),
    distance: z.number().min(18).max(500),
  })
  .strict();
const collectible = z
  .object({
    key: z.string().trim().max(80).default(""),
    kind: z.enum(["coin", "fuel", "crystal", "star"]),
    lane: z.number().int().min(-1).max(1),
    distance: z.number().min(18).max(500),
  })
  .strict();
const enemy = z
  .object({
    key: z.string().trim().max(80).default(""),
    kind: z.enum(["drone", "asteroid", "sentinel"]),
    lane: z.number().int().min(-1).max(1),
    distance: z.number().min(18).max(500),
  })
  .strict();
const suit = z
  .object({
    key: z.string().trim().max(80).default(""),
    name: z.string().trim().min(1).max(48),
    description: z.string().trim().min(1).max(100),
    accent: z.enum(["crimson", "cyan", "gold", "violet", "emerald", "silver", "obsidian"]),
  })
  .strict();
const base = {
  schemaVersion: z.literal(3),
  dimension: z.literal("3d"),
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
  gameType: gameTypeSchema,
  theme: z.string().trim().min(1).max(80),
  visualStyle: z.string().trim().min(1).max(120),
  world: z.string().trim().min(1).max(120),
  player: z.string().trim().min(1).max(140),
  playerController: playerControllerSchema.default("auto"),
  objective: z.string().trim().min(1).max(140),
  coreLoop: z.string().trim().min(1).max(180).default(""),
  camera: z
    .object({
      fov: z.number().min(45).max(85),
      followDistance: z.number().min(4).max(20),
      height: z.number().min(2).max(10),
    })
    .strict(),
  lighting: z
    .object({
      ambient: z.number().min(0.15).max(1.2),
      directional: z.number().min(0.2).max(2),
      fogDistance: z.number().min(40).max(220),
    })
    .strict(),
  physics: z
    .object({
      gravity: z.number().min(5).max(20).default(10),
      friction: z.number().min(0.05).max(0.9).default(0.28),
      collisionRadius: z.number().min(0.4).max(1.4).default(0.8),
    })
    .strict()
    .default({ gravity: 10, friction: 0.28, collisionRadius: 0.8 }),
  materialStyle: z.enum(["stylized", "metallic", "matte", "stone", "organic"]).default("stylized"),
  scoring: z
    .object({
      distancePoints: z.number().int().min(0).max(10).default(2),
      collectiblePoints: z.number().int().min(0).max(500).default(50),
      enemyPoints: z.number().int().min(0).max(500).default(100),
    })
    .strict()
    .default({ distancePoints: 2, collectiblePoints: 50, enemyPoints: 100 }),
  health: z.number().int().min(1).max(8).default(1),
  audio: z
    .object({
      enabled: z.boolean().default(false),
      volume: z.number().min(0).max(1).default(0.45),
    })
    .strict()
    .default({ enabled: false, volume: 0.45 }),
  ui: z
    .object({
      touchControls: z.boolean().default(true),
      hudScale: z.number().min(0.8).max(1.2).default(1),
    })
    .strict()
    .default({ touchControls: true, hudScale: 1 }),
  controls: z.array(z.string().trim().min(1).max(60)).min(2).max(8),
  obstacles: z.array(placement).max(24),
  enemies: z.array(enemy).max(12),
  collectibles: z.array(collectible).max(24),
  objectives: z.array(z.string().trim().min(1).max(100)).min(1).max(5),
  levels: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(40),
          distance: z.number().min(80).max(500),
          speedScale: z.number().min(0.8).max(1.8),
        })
        .strict(),
    )
    .min(1)
    .max(5),
  difficulty: z.enum(["easy", "normal", "hard"]),
  winCondition: z.string().trim().min(1).max(120),
  loseCondition: z.string().trim().min(1).max(120),
  seed: z.number().int().min(0).max(2_147_483_647),
  palette: z.enum(["neon", "jungle", "desert", "space", "ancient"]),
  // Defaults keep already-saved v3 specs valid as the visual schema evolves.
  environmentPreset: z
    .enum([
      "city",
      "jungle-temple",
      "desert-dunes",
      "space-nebula",
      "mountain-pass",
      "ancient-ruins",
    ])
    .default("city"),
  timeOfDay: z.enum(["night", "dawn", "day", "sunset", "deep-space"]).default("night"),
  terrainStyle: z.enum(["road", "sand", "grass", "stone", "asteroid-field"]).default("road"),
  architectureStyle: z.enum(["neon-city", "temple", "modern", "none", "sci-fi"]).default("none"),
  vegetationStyle: z.enum(["lush-jungle", "cacti", "pine", "none"]).default("none"),
  lightingPreset: z
    .enum(["neon-night", "golden-hour", "overcast", "moonlit", "deep-space"])
    .default("neon-night"),
  atmosphere: z.enum(["clear", "mist", "dust", "haze", "nebula"]).default("clear"),
  assetDensity: z.number().int().min(1).max(5).default(3),
  particleIntensity: z.number().min(0).max(1).default(0.35),
};

const Game3DSpecInputSchema = z.discriminatedUnion("gameType", [
  z
    .object({
      ...base,
      gameType: z.literal("runner"),
      mechanics: z
        .object({
          laneCount: z.literal(3),
          jumpHeight: z.number().min(1).max(5),
          speed: z.number().min(6).max(18),
          finishDistance: z.number().min(80).max(500),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("rally"),
      mechanics: z
        .object({
          fuelCapacity: z.number().min(50).max(200),
          fuelDrain: z.number().min(0.05).max(1),
          acceleration: z.number().min(4).max(18),
          finishDistance: z.number().min(80).max(500),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("racing"),
      mechanics: z
        .object({
          fuelCapacity: z.number().min(50).max(200),
          fuelDrain: z.number().min(0.05).max(1),
          acceleration: z.number().min(4).max(18),
          finishDistance: z.number().min(80).max(500),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("shooter"),
      mechanics: z
        .object({
          fireRate: z.number().min(0.12).max(1),
          playerSpeed: z.number().min(3).max(12),
          health: z.number().int().min(1).max(8),
          targetKills: z.number().int().min(5).max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("adventure"),
      mechanics: z
        .object({
          playerSpeed: z.number().min(2).max(8),
          jumpHeight: z.number().min(1).max(5),
          collectibleGoal: z.number().int().min(1).max(12),
          finishDistance: z.number().min(80).max(400),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("exploration"),
      mechanics: z
        .object({
          playerSpeed: z.number().min(2).max(8),
          jumpHeight: z.number().min(1).max(5),
          collectibleGoal: z.number().int().min(1).max(12),
          finishDistance: z.number().min(80).max(400),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("platformer"),
      mechanics: z
        .object({
          playerSpeed: z.number().min(2).max(8),
          jumpHeight: z.number().min(1).max(5),
          collectibleGoal: z.number().int().min(1).max(12),
          finishDistance: z.number().min(80).max(400),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      gameType: z.literal("fighting"),
      suits: z.array(suit).min(2).max(8),
      mechanics: z
        .object({
          playerHealth: z.number().int().min(60).max(200),
          enemyHealth: z.number().int().min(20).max(120),
          enemyCount: z.number().int().min(2).max(5),
          battleCount: z.number().int().min(1).max(5),
          comboTarget: z.number().int().min(3).max(20),
          suitUnlockEvery: z.number().int().min(1).max(10),
          punchDamage: z.number().int().min(8).max(40),
          kickDamage: z.number().int().min(12).max(60),
          webDamage: z.number().int().min(5).max(35),
        })
        .strict(),
    })
    .strict(),
]);

/** Normalize compatible old specs and assign unique stable keys to every runtime entity. */
export const Game3DSpecSchema = Game3DSpecInputSchema.transform((spec) => {
  const used = new Set<string>();
  const assignKeys = <T extends { key?: string }>(
    items: T[],
    prefix: string,
  ): Array<Omit<T, "key"> & { key: string }> =>
    items.map((item, index) => {
      let key = item.key?.trim();
      if (!key || used.has(key)) {
        const baseKey = `${prefix}-${index + 1}`;
        key = baseKey;
        let suffix = 2;
        while (used.has(key)) key = `${baseKey}-${suffix++}`;
      }
      used.add(key);
      return { ...item, key } as Omit<T, "key"> & { key: string };
    });
  const controllerByGenre: Record<
    z.infer<typeof gameTypeSchema>,
    Exclude<z.infer<typeof playerControllerSchema>, "auto">
  > = {
    runner: "lane-runner",
    rally: "vehicle",
    racing: "vehicle",
    shooter: "space-shooter",
    adventure: "third-person",
    exploration: "third-person",
    platformer: "third-person",
    fighting: "arena-fighter",
  };
  const coreLoopByGenre: Record<z.infer<typeof gameTypeSchema>, string> = {
    runner: "Steer between lanes, jump over hazards, collect rewards, and reach the finish.",
    rally: "Steer and manage acceleration and fuel to avoid rocks and reach the finish.",
    racing: "Steer and manage acceleration and fuel to avoid hazards and reach the finish.",
    shooter: "Move to line up shots, destroy hostile targets, and survive incoming fire.",
    adventure: "Explore the course, jump between terrain, collect relics, and reach the goal.",
    exploration: "Explore the course, jump between terrain, collect relics, and reach the goal.",
    platformer: "Move and jump across platforms, collect rewards, and reach the goal.",
    fighting: "Move, dodge, and chain attacks to defeat each wave and advance.",
  };
  return {
    ...spec,
    coreLoop: spec.coreLoop.trim() || coreLoopByGenre[spec.gameType],
    playerController:
      spec.playerController === "auto" ? controllerByGenre[spec.gameType] : spec.playerController,
    obstacles: assignKeys(spec.obstacles, "obstacle"),
    enemies: assignKeys(spec.enemies, "enemy"),
    collectibles: assignKeys(spec.collectibles, "collectible"),
    ...(spec.gameType === "fighting" ? { suits: assignKeys(spec.suits, "suit") } : {}),
  };
});

export type Game3DSpec = z.infer<typeof Game3DSpecSchema>;

export const INVALID_GAME_3D_PREVIEW_MESSAGE =
  "This saved game has incomplete or invalid 3D data. Choose another saved game or create a fresh one.";
export function parseGame3DSpecForPreview(
  value: unknown,
): { spec: Game3DSpec } | { error: string } {
  const parsed = Game3DSpecSchema.safeParse(value);
  return parsed.success ? { spec: parsed.data } : { error: INVALID_GAME_3D_PREVIEW_MESSAGE };
}
