import type { Game3DSpec } from "../../game-spec-3d";

export type FightingSpec = Extract<Game3DSpec, { gameType: "fighting" }>;
export type CombatMove = "punch" | "kick" | "web";

export type FightingProgress = {
  wins: number;
  selectedSuitKey: string;
  unlockedSuitKeys: string[];
};

export function getUnlockedSuitKeys(spec: FightingSpec, wins: number): string[] {
  const completed = Math.max(0, Math.floor(wins));
  return spec.suits
    .filter((_, index) => index === 0 || completed >= index * spec.mechanics.suitUnlockEvery)
    .map((suit) => suit.key);
}

export function createFightingProgress(
  spec: FightingSpec,
  wins = 0,
  selectedSuitKey?: string,
): FightingProgress {
  const unlockedSuitKeys = getUnlockedSuitKeys(spec, wins);
  const selected =
    selectedSuitKey && unlockedSuitKeys.includes(selectedSuitKey)
      ? selectedSuitKey
      : unlockedSuitKeys[0];
  return { wins: Math.max(0, Math.floor(wins)), selectedSuitKey: selected, unlockedSuitKeys };
}

export function canSelectFightingSuit(spec: FightingSpec, wins: number, suitKey: string): boolean {
  return getUnlockedSuitKeys(spec, wins).includes(suitKey);
}

export function getFightRoundNumber(spec: FightingSpec, completedFights: number): number {
  return (Math.max(0, Math.floor(completedFights)) % spec.mechanics.battleCount) + 1;
}

export function getFightEnemyCount(spec: FightingSpec, completedFights: number): number {
  const set = Math.floor(Math.max(0, completedFights) / spec.mechanics.battleCount);
  return Math.min(5, spec.mechanics.enemyCount + set);
}

export function getFightEnemyHealth(spec: FightingSpec, completedFights: number): number {
  const round = getFightRoundNumber(spec, completedFights);
  const set = Math.floor(Math.max(0, completedFights) / spec.mechanics.battleCount);
  return Math.round(spec.mechanics.enemyHealth * (1 + (round - 1) * 0.18 + set * 0.25));
}

export function getCombatDamage(spec: FightingSpec, move: CombatMove, comboCount: number): number {
  const base =
    move === "punch"
      ? spec.mechanics.punchDamage
      : move === "kick"
        ? spec.mechanics.kickDamage
        : spec.mechanics.webDamage;
  return Math.round(base * Math.min(1.8, 1 + Math.max(0, comboCount - 1) * 0.08));
}

export function applyEnemyDamage(health: number, damage: number): number {
  return Math.max(0, Math.floor(health - Math.max(0, damage)));
}
