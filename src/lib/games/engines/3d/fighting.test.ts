import { describe, expect, it } from "vitest";
import { Game3DSpecSchema, type Game3DSpec } from "../../game-spec-3d";
import {
  applyEnemyDamage,
  canSelectFightingSuit,
  createFightingProgress,
  getCombatDamage,
  getFightEnemyCount,
  getFightEnemyHealth,
  getFightRoundNumber,
  getUnlockedSuitKeys,
} from "./fighting";

const fighting = Game3DSpecSchema.parse({
  schemaVersion: 3,
  dimension: "3d",
  title: "Web Warden: Rooftop Trials",
  description: "An original web-powered hero battles three waves of fighters.",
  gameType: "fighting",
  theme: "neon rooftop superhero arena",
  visualStyle: "Stylized original comic-book hero and fighters",
  world: "A rooftop arena above a neon city",
  player: "Original spider-themed hero",
  objective: "Defeat three progressively harder fights and unlock new suits.",
  camera: { fov: 58, followDistance: 12, height: 6 },
  lighting: { ambient: 0.55, directional: 1.25, fogDistance: 150 },
  controls: ["A/D move", "J punch", "K kick", "Space dodge", "L web strike"],
  obstacles: [],
  enemies: [],
  collectibles: [],
  objectives: ["Win fights", "Unlock suits"],
  levels: [{ name: "Rooftop", distance: 100, speedScale: 1 }],
  difficulty: "normal",
  winCondition: "Defeat all fighters.",
  loseCondition: "Player health reaches zero.",
  seed: 91,
  palette: "neon",
  environmentPreset: "city",
  timeOfDay: "night",
  terrainStyle: "road",
  architectureStyle: "neon-city",
  vegetationStyle: "none",
  lightingPreset: "neon-night",
  atmosphere: "haze",
  assetDensity: 3,
  particleIntensity: 0.3,
  suits: [
    { name: "Threadguard", description: "Balanced crimson and obsidian suit", accent: "crimson" },
    { name: "Pulseweave", description: "Fast cyan energy suit", accent: "cyan" },
    { name: "Sunspider", description: "Powerful gold-trimmed suit", accent: "gold" },
  ],
  mechanics: {
    playerHealth: 120,
    enemyHealth: 70,
    enemyCount: 3,
    battleCount: 3,
    comboTarget: 8,
    suitUnlockEvery: 3,
    punchDamage: 18,
    kickDamage: 28,
    webDamage: 12,
  },
}) as Extract<Game3DSpec, { gameType: "fighting" }>;

describe("3D fighting gameplay contract", () => {
  it("keeps three battle rounds and unlocks the next suit after three completed fights", () => {
    expect(getFightRoundNumber(fighting, 0)).toBe(1);
    expect(getFightRoundNumber(fighting, 2)).toBe(3);
    expect(getFightRoundNumber(fighting, 3)).toBe(1);
    expect(getUnlockedSuitKeys(fighting, 0)).toHaveLength(1);
    expect(getUnlockedSuitKeys(fighting, 2)).toHaveLength(1);
    expect(getUnlockedSuitKeys(fighting, 3)).toHaveLength(2);
    expect(canSelectFightingSuit(fighting, 2, fighting.suits[1].key)).toBe(false);
    expect(canSelectFightingSuit(fighting, 3, fighting.suits[1].key)).toBe(true);
    expect(createFightingProgress(fighting, 3, fighting.suits[1].key).selectedSuitKey).toBe(
      fighting.suits[1].key,
    );
  });

  it("scales multiple enemies and health across rounds and supports distinct combat moves", () => {
    expect(getFightEnemyCount(fighting, 0)).toBe(3);
    expect(getFightEnemyCount(fighting, 3)).toBe(4);
    expect(getFightEnemyHealth(fighting, 2)).toBeGreaterThan(getFightEnemyHealth(fighting, 0));
    expect(getCombatDamage(fighting, "kick", 3)).toBeGreaterThan(
      getCombatDamage(fighting, "punch", 1),
    );
    expect(getCombatDamage(fighting, "web", 1)).toBe(12);
    expect(applyEnemyDamage(10, 18)).toBe(0);
  });
});
