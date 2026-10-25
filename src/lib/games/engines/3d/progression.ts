import type { Game3DSpec } from "../../game-spec-3d";

export type ThreeGameOutcome = "playing" | "completed" | "failed";

export interface ThreeGameProgress {
  distance: number;
  health: number;
  fuel: number;
  kills: number;
  collectibles: number;
  victories: number;
}

/** Shared win/loss contract used by the renderer and deterministic gameplay tests. */
export function evaluateThreeGameOutcome(
  spec: Game3DSpec,
  progress: ThreeGameProgress,
): ThreeGameOutcome {
  if (spec.gameType === "fighting") {
    if (progress.health <= 0) return "failed";
    return progress.victories >= spec.mechanics.battleCount ? "completed" : "playing";
  }
  if (progress.health <= 0) return "failed";
  if ((spec.gameType === "rally" || spec.gameType === "racing") && progress.fuel <= 0)
    return "failed";
  if (spec.gameType === "shooter")
    return progress.kills >= spec.mechanics.targetKills ? "completed" : "playing";
  if (spec.gameType === "runner" || spec.gameType === "rally" || spec.gameType === "racing")
    return progress.distance >= spec.mechanics.finishDistance ? "completed" : "playing";
  if (
    spec.gameType === "adventure" ||
    spec.gameType === "exploration" ||
    spec.gameType === "platformer"
  ) {
    return progress.distance >= spec.mechanics.finishDistance ||
      progress.collectibles >= spec.mechanics.collectibleGoal
      ? "completed"
      : "playing";
  }
  return "playing";
}
