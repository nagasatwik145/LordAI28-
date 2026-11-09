import { GameServiceError } from "./game-service";

export function upstreamStatus(error: unknown, depth = 0): number | undefined {
  if (!error || typeof error !== "object" || depth > 4) return undefined;
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    lastError?: unknown;
    cause?: unknown;
  };
  if (typeof value.statusCode === "number") return value.statusCode;
  if (typeof value.status === "number") return value.status;
  return upstreamStatus(value.lastError ?? value.cause, depth + 1);
}

export function generationFailure(error: unknown): GameServiceError {
  if (error instanceof GameServiceError) return error;
  if (error instanceof Error && error.message.includes("OPENROUTER_API_KEY")) {
    return new GameServiceError(
      "not_configured",
      "Game generation is not configured on the server.",
    );
  }
  const status = upstreamStatus(error);
  if (status === 429)
    return new GameServiceError(
      "rate_limited",
      "The AI provider is rate-limiting game generation. Try again shortly.",
    );
  if (status === 404)
    return new GameServiceError(
      "model_unavailable",
      "The configured game model is unavailable. Contact support.",
    );
  if (error instanceof Error && /timeout|timed out|abort/i.test(error.message))
    return new GameServiceError("timeout", "Game generation timed out. Please try again.");
  return new GameServiceError("generation", "Game generation failed. Please try again.");
}
