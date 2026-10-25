import { authenticatedFetch } from "@/lib/authenticated-fetch";

type ApiError = { code?: string; message?: string } | string;

export async function requestGamesApi<T = Record<string, unknown>>(body: object): Promise<T> {
  let response: Response;
  try {
    response = await authenticatedFetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach LORD AI. Check your connection and try again.");
  }

  let result: { error?: ApiError };
  try {
    result = (await response.json()) as { error?: ApiError };
  } catch {
    throw new Error("LORD AI returned an unreadable response. Please try again.");
  }
  if (response.ok) return result as T;

  const details = typeof result.error === "object" ? result.error : undefined;
  const serverMessage = details?.message ?? (typeof result.error === "string" ? result.error : "");
  if (response.status === 401 || details?.code === "AI_AUTH_ERROR") {
    throw new Error("Your sign-in expired. Sign in again, then create your game.");
  }
  if (details?.code === "DB_ERROR") {
    throw new Error("The game could not be saved. Check your connection and try again.");
  }
  if (details?.code === "PRO_REQUIRED") {
    throw new Error(serverMessage || "LORD Pro is required to use 3D games.");
  }
  if (details?.code === "PRO_CHECK_UNAVAILABLE") {
    throw new Error(serverMessage || "Game access could not be verified. Please retry.");
  }
  if (details?.code === "AI_NOT_CONFIGURED") {
    throw new Error("Game generation is temporarily unavailable. Please try again later.");
  }
  if (details?.code === "AI_GENERATION_FAILED") {
    throw new Error(serverMessage || "Game generation failed. Please try again.");
  }
  if (details?.code === "AI_RATE_LIMITED") {
    throw new Error("The game generation service is busy. Please try again in a minute.");
  }
  if (details?.code === "AI_TIMEOUT") {
    throw new Error("Game generation took too long. Please try again.");
  }
  if (details?.code === "AI_MODEL_UNAVAILABLE") {
    throw new Error("Game generation is temporarily unavailable. Please try again later.");
  }
  if (details?.code === "GAME_TYPE_UNSUPPORTED") {
    throw new Error(serverMessage || "That game mode is not supported yet. Try runner, rally, platformer, shooter, or puzzle.");
  }
  throw new Error(serverMessage || `Game request failed (${response.status}). Please try again.`);
}

export class SingleFlightGate {
  private active = false;

  run<T>(task: () => Promise<T>): Promise<T> | null {
    if (this.active) return null;
    this.active = true;
    return task().finally(() => {
      this.active = false;
    });
  }
}
