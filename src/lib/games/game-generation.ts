import { Game3DSpecSchema } from "./game-spec-3d";
import { GameSpecSchema, type GeneratedGameSpec, type GameSpec } from "./game-runtime";
import { GameServiceError } from "./game-service";
import { z } from "zod";

export const UnsupportedGameSchema = z
  .object({ unsupported: z.literal(true), message: z.string().min(1).max(220) })
  .strict();
export const GamePlannerResponseSchema = z.union([
  GameSpecSchema,
  Game3DSpecSchema,
  UnsupportedGameSchema,
]);

export const GAME_PLANNER_SYSTEM = `You create validated data-only game specifications for LORD AI. Preserve the user's requested core genre and mechanics. Never silently substitute a shooter for a fighting game, or any genre for another. Read all prompt clauses, including progression and unlock rules. Correct obvious context-supported typos (for example, "spider suites unlock" means "spider suits unlock"). Never use copyrighted characters or assets; make original characters inspired by broad themes.

3D gameType must be one of runner, rally, racing, shooter, adventure, exploration, platformer, fighting. These are distinct supported mechanics and render paths. For 2D use runner, rally, platformer, shooter, puzzle.

For 2D return schemaVersion 2 and fields title, description, gameType, theme, player, world, difficulty, objective, controls, visualStyle, winCondition, loseCondition, seed, mechanics. 2D mechanics: runner {obstacleDensity .5..2,collectibleDensity .2..2,jumpHeight .7..1.4,finishDistance 80..240}; rally {fuelCapacity 50..200,fuelDrain .1..1,rockDensity .4..2,fuelPickupRate .3..2,finishDistance 80..240}; platformer {platformCount integer 5..16,hazardCount integer 1..8,collectibleCount integer 2..12}; shooter {fireRate .12.. .8,enemyDensity .3..2,playerSpeed 2..8,targetKills integer 8..20}; puzzle {gridSize integer 5..8,colorCount integer 3..6,matchLength integer 3..4,targetMatches integer 3..12}.

For 3D return schemaVersion 3, dimension "3d", title <=60, description <=300, theme <=80, visualStyle <=120, world <=120, player <=140, playerController (lane-runner|vehicle|space-shooter|third-person|arena-fighter), objective <=140, coreLoop <=180 (one sentence describing the repeated player actions and progression), controls (2..8 strings <=60), camera {fov 45..85,followDistance 4..20,height 2..10}, lighting {ambient .15..1.2,directional .2..2,fogDistance 40..220}, physics {gravity 5..20,friction .05.. .9,collisionRadius .4..1.4}, materialStyle (stylized|metallic|matte|stone|organic), scoring {distancePoints 0..10,collectiblePoints 0..500,enemyPoints 0..500}, health 1..8, audio {enabled boolean,volume 0..1}, ui {touchControls boolean,hudScale .8..1.2}, obstacles (0..24 {kind barrier|rock|asteroid|hazard|platform,lane -1..1,distance 18..500}), enemies (0..12 {kind drone|asteroid|sentinel,lane -1..1,distance 18..500}), collectibles (0..24 {kind coin|fuel|crystal|star,lane -1..1,distance 18..500}), objectives (1..5), levels (1..5 {name,distance 80..500,speedScale .8..1.8}), difficulty, winCondition, loseCondition, seed, palette (neon|jungle|desert|space|ancient), and the supported visual fields defined by schema. The checked-in renderer uses these data-only settings; never emit code or asset paths. Choose visual fields from the actual theme.

3D mechanics by gameType: runner {laneCount:3,jumpHeight 1..5,speed 6..18,finishDistance 80..500}; rally or racing {fuelCapacity 50..200,fuelDrain .05..1,acceleration 4..18,finishDistance 80..500}; shooter {fireRate .12..1,playerSpeed 3..12,health 1..8,targetKills 5..20}; adventure, exploration, or platformer {playerSpeed 2..8,jumpHeight 1..5,collectibleGoal 1..12,finishDistance 80..400}; fighting {suits: 2..8 original suits {name <=48,description <=100,accent crimson|cyan|gold|violet|emerald|silver|obsidian}, mechanics {playerHealth 60..200,enemyHealth 20..120,enemyCount 2..5,battleCount 1..5,comboTarget 3..20,suitUnlockEvery 1..10,punchDamage 8..40,kickDamage 12..60,webDamage 5..35}}. For superhero/fighting ideas use an original hero and original opponents, close-range punch/kick, dodge, combo, enemy health, and web-based melee/ranged control as fitting. Preserve requested fight count and unlock cadence exactly. Example: a request for suits unlocked after three fights sets suitUnlockEvery=3 and provides multiple suit choices.

Controls: runner left/right or A/D, Space jump; rally/racing left/right or A/D steer, Enter accelerate, Shift brake; shooter arrows/A-D and W/S move, J fire; adventure/exploration/platformer arrows/A-D move, W/up forward, Space jump; fighting arrows/A-D move, J punch, K kick, Space dodge, L web strike. Don't output explanatory prose, code, HTML, URLs, external asset names, or unsupported fields. Unsupported game requests return {"unsupported":true,"message":"brief limitation and supported alternatives"}. During customization preserve gameType, dimension, and unrequested mechanics.`;

export type GameIntent =
  | "fighting"
  | "shooter"
  | "runner"
  | "racing"
  | "rally"
  | "platformer"
  | "exploration"
  | "adventure"
  | "puzzle"
  | null;

export function normalizeGamePrompt(prompt: string): string {
  if (!/spider|superhero|unlock|costume|outfit/i.test(prompt)) return prompt;
  return prompt.replace(/\bsuites\b/gi, "suits");
}

export function classifyGameIntent(prompt: string): GameIntent {
  const text = normalizeGamePrompt(prompt).toLowerCase();
  if (
    /\b(fighting game|fighter game|fighting|fighter|brawler|beat[ -]?em[ -]?up|boxing|martial arts|punch(?:es|ing)?|kick(?:s|ing)?|combo)\b/.test(
      text,
    )
  )
    return "fighting";
  if (
    /\b(shooter|shooting game|space combat game|fire (?:a )?(?:weapon|blaster)|shoot(?:ing)? (?:enemies|targets|asteroids))\b/.test(
      text,
    )
  )
    return "shooter";
  if (/\b(runner|endless run|run through|running game)\b/.test(text)) return "runner";
  if (/\b(racing|race car|car race|rally|driving game|vehicle race)\b/.test(text))
    return /\brally\b/.test(text) ? "rally" : "racing";
  if (/\b(platformer|platform game|jump between platforms|side[ -]?scroller)\b/.test(text))
    return "platformer";
  if (/\b(exploration|explore|discover the world)\b/.test(text)) return "exploration";
  if (/\b(adventure)\b/.test(text)) return "adventure";
  if (/\b(puzzle|matching tiles|solve the board)\b/.test(text)) return "puzzle";
  return null;
}

function expectedGeneratedType(intent: GameIntent, dimension: "2d" | "3d"): string | null {
  if (!intent) return null;
  if (dimension === "3d") return intent;
  if (intent === "racing") return "rally";
  if (intent === "fighting") return null;
  return intent;
}

function parseModelResponse(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
}

function applyPromptRequirements(spec: GeneratedGameSpec, prompt: string): GeneratedGameSpec {
  if (spec.schemaVersion !== 3 || spec.gameType !== "fighting") return spec;
  const cadence = prompt.match(
    /(?:unlock(?:s|ed)?\s+\w+\s+after|after)\s+(\d+)\s+(?:completed\s+)?fights?/i,
  );
  const suitUnlockEvery = cadence
    ? Math.max(1, Math.min(10, Number(cadence[1])))
    : spec.mechanics.suitUnlockEvery;
  const battleCount = cadence ? suitUnlockEvery : spec.mechanics.battleCount;
  const player = /spider[ -]?man/i.test(spec.player) ? "Original spider-themed hero" : spec.player;
  return Game3DSpecSchema.parse({
    ...spec,
    player,
    mechanics: { ...spec.mechanics, battleCount, suitUnlockEvery },
  });
}

function preserveUnrequestedSections(
  existing: GeneratedGameSpec,
  generated: GeneratedGameSpec,
  instruction: string,
): GeneratedGameSpec {
  const groups: Array<[RegExp, string[]]> = [
    [/\b(rename|retitle|call it|change the name|new title)\b/i, ["title", "description"]],
    [
      /\b(theme|visual|look|color|colour|environment|world|biome|lighting|weather|material|texture|style|background)\b/i,
      [
        "theme",
        "visualStyle",
        "world",
        "palette",
        "environmentPreset",
        "timeOfDay",
        "terrainStyle",
        "architectureStyle",
        "vegetationStyle",
        "lightingPreset",
        "atmosphere",
        "assetDensity",
        "particleIntensity",
        "materialStyle",
      ],
    ],
    [/\b(camera|viewpoint|field of view|follow distance)\b/i, ["camera"]],
    [/\b(physics|gravity|friction|collision|collisions|hitbox)\b/i, ["physics"]],
    [/\b(sound|audio|music|volume|mute)\b/i, ["audio"]],
    [/\b(score|scoring|points|reward)\b/i, ["scoring"]],
    [/\b(health|lives|damage|survivability)\b/i, ["health", "mechanics"]],
    [/\b(control|controls|touch|keyboard|mobile|button|input)\b/i, ["controls", "ui"]],
    [
      /\b(level|levels|progression|checkpoint|stage|unlock)\b/i,
      ["levels", "objectives", "winCondition", "mechanics"],
    ],
    [
      /\b(player|character|hero|vehicle|spaceship|suit|costume|controller|movement|jump|speed|ability|abilities)\b/i,
      ["player", "playerController", "suits", "mechanics", "physics"],
    ],
    [
      /\b(enemy|enemies|opponent|opponents|obstacle|obstacles|hazard|hazards|pickup|pickups|collectible|collectibles|fight|battle|combat|shoot|weapon|fuel|rock|platform)\b/i,
      [
        "enemies",
        "obstacles",
        "collectibles",
        "mechanics",
        "objectives",
        "winCondition",
        "loseCondition",
      ],
    ],
    [
      /\b(difficulty|harder|easier|challenge|challenging|fun|exciting|engaging)\b/i,
      ["difficulty", "mechanics", "levels", "enemies", "obstacles", "health", "loseCondition"],
    ],
    [
      /\b(objective|goal|win|lose|finish|ending|mission)\b/i,
      ["objective", "objectives", "winCondition", "loseCondition", "mechanics"],
    ],
  ];
  const allowed = new Set(
    groups.flatMap(([pattern, fields]) => (pattern.test(instruction) ? fields : [])),
  );
  if (!allowed.size) {
    throw new GameServiceError(
      "unsupported",
      "Specify which game section to change, such as visuals, controls, physics, levels, sound, scoring, or difficulty.",
    );
  }
  const merged = { ...existing } as Record<string, unknown>;
  const next = generated as unknown as Record<string, unknown>;
  for (const field of allowed) {
    if (field in next) merged[field] = next[field];
  }
  return existing.schemaVersion === 3
    ? Game3DSpecSchema.parse(merged)
    : GameSpecSchema.parse(merged);
}

export async function planGameSpec(args: {
  prompt: string;
  difficulty: GameSpec["difficulty"];
  generate: (system: string, prompt: string) => Promise<unknown>;
  existing?: GeneratedGameSpec;
  instruction?: string;
  dimension?: "2d" | "3d";
}): Promise<GeneratedGameSpec> {
  const intent = args.existing ? null : classifyGameIntent(args.prompt);
  const explicit2d = /\b2d\b/i.test(args.prompt);
  const explicit3d = /\b3d\b|three[ -]?dimensional/i.test(args.prompt);
  const dimension: "2d" | "3d" =
    !args.existing &&
    !explicit2d &&
    (intent === "fighting" || intent === "exploration" || intent === "adventure")
      ? "3d"
      : explicit3d
        ? "3d"
        : (args.dimension ?? "2d");
  if (intent === "fighting" && explicit2d)
    throw new GameServiceError(
      "unsupported",
      "Fighting games currently require the 3D game studio. Remove the 2D restriction or choose a supported 2D genre.",
    );
  if (intent === "exploration" && explicit2d)
    throw new GameServiceError(
      "unsupported",
      "Exploration games currently require the 3D game studio. Remove the 2D restriction or choose a supported 2D genre.",
    );
  if (intent === "adventure" && explicit2d)
    throw new GameServiceError(
      "unsupported",
      "Adventure games currently require the 3D game studio. Remove the 2D restriction or choose a supported 2D genre.",
    );
  const expectedType = args.existing ? null : expectedGeneratedType(intent, dimension);
  const normalizedPrompt = normalizeGamePrompt(args.prompt);
  const userPrompt = args.existing
    ? `Current complete game specification: ${JSON.stringify(args.existing)}\nUser customization request: ${args.instruction}\nReturn a complete updated specification; preserve all mechanics not requested to change.`
    : `Complete game idea from the user: ${args.prompt}${normalizedPrompt !== args.prompt ? `\nContext-corrected spelling for interpretation: ${normalizedPrompt}` : ""}\nDetected genre intent: ${intent ?? "infer from prompt"}\nPreferred dimension: ${dimension}\nRequested difficulty: ${args.difficulty}\nChoose mechanics that fulfill every interaction, combat, and progression requirement.`;
  let parsed = parseModelResponse(await args.generate(GAME_PLANNER_SYSTEM, userPrompt));
  if (
    parsed &&
    typeof parsed === "object" &&
    "unsupported" in parsed &&
    (parsed as { unsupported?: unknown }).unsupported === true
  ) {
    const message =
      "message" in parsed && typeof (parsed as { message?: unknown }).message === "string"
        ? (parsed as { message: string }).message.slice(0, 220)
        : "That gameplay is not supported yet. Try runner, rally, platformer, shooter, or puzzle.";
    throw new GameServiceError("unsupported", message);
  }
  const parseSpec = (value: unknown): GeneratedGameSpec | null => {
    const result = GameSpecSchema.safeParse(value);
    const result3d = Game3DSpecSchema.safeParse(value);
    return result.success ? result.data : result3d.success ? result3d.data : null;
  };
  let generated = parseSpec(parsed);
  if (
    (!generated ||
      (expectedType &&
        (generated.gameType !== expectedType ||
          (dimension === "3d" && generated.schemaVersion !== 3)))) &&
    expectedType
  ) {
    const correction = `${userPrompt}\n\nGENRE VALIDATION RETRY: The previous response did not match the requested ${expectedType} game. Return a complete schemaVersion ${dimension === "3d" ? 3 : 2} spec with gameType exactly "${expectedType}". Do not substitute another genre. Preserve the user's original mechanics and progression.`;
    parsed = parseModelResponse(await args.generate(GAME_PLANNER_SYSTEM, correction));
    generated = parseSpec(parsed);
  }
  if (!generated)
    throw new Error("The game model returned an invalid or unsupported specification.");
  if (
    expectedType &&
    (generated.gameType !== expectedType || (dimension === "3d" && generated.schemaVersion !== 3))
  )
    throw new Error(
      `The game model did not preserve the requested ${expectedType} genre. Please try again.`,
    );
  const promptRequirementsApplied =
    !args.existing && expectedType === "fighting"
      ? applyPromptRequirements(generated, args.prompt)
      : generated;
  if (
    args.existing &&
    (promptRequirementsApplied.gameType !== args.existing.gameType ||
      (promptRequirementsApplied.schemaVersion === 3) !== (args.existing.schemaVersion === 3))
  ) {
    const target =
      promptRequirementsApplied.gameType === args.existing.gameType
        ? "3D"
        : promptRequirementsApplied.gameType;
    const explicitChange = new RegExp(
      `\\b(?:change|switch|convert|turn|make)\\b[^.]{0,50}\\b${target}\\b`,
      "i",
    );
    if (!explicitChange.test(args.instruction ?? ""))
      throw new Error(
        "The customization changed the game type without being asked, or changed the dimension without being asked. Your current game was kept.",
      );
    return promptRequirementsApplied;
  }
  return args.existing
    ? preserveUnrequestedSections(args.existing, promptRequirementsApplied, args.instruction ?? "")
    : promptRequirementsApplied;
}
