import type { Game3DSpec } from "./game-spec-3d";

export type ThreeDControlAction =
  | "left"
  | "right"
  | "jump"
  | "accelerate"
  | "brake"
  | "up"
  | "down"
  | "fire"
  | "punch"
  | "kick"
  | "dodge"
  | "web";

export const THREE_D_CONTROLS = {
  runner: { movement: ["left", "right"], actions: ["jump"] },
  rally: { movement: ["left", "right"], actions: ["accelerate", "brake"] },
  racing: { movement: ["left", "right"], actions: ["accelerate", "brake"] },
  shooter: { movement: ["left", "right", "up", "down"], actions: ["fire"] },
  adventure: { movement: ["left", "right", "up"], actions: ["jump"] },
  exploration: { movement: ["left", "right", "up"], actions: ["jump"] },
  platformer: { movement: ["left", "right", "up"], actions: ["jump"] },
  fighting: {
    movement: ["left", "right", "up", "down"],
    actions: ["punch", "kick", "dodge", "web"],
  },
} satisfies Record<
  Game3DSpec["gameType"],
  { movement: readonly ThreeDControlAction[]; actions: readonly ThreeDControlAction[] }
>;
