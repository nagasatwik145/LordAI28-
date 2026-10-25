import { z } from "zod";

export const AnalyticsEventSchema = z
  .object({
    event: z.enum([
      "onboarding_started",
      "onboarding_completed",
      "feature_tour_completed",
      "feature_opened",
      "chat_succeeded",
      "chat_failed",
      "study_session_completed",
      "game_generation_succeeded",
      "game_generation_failed",
      "mission_completed",
      "mission_failed",
      "subscription_checkout_initiated",
      "subscription_checkout_confirmed",
    ]),
    feature: z
      .enum(["chat", "study", "games", "missions", "images", "workspace", "other"])
      .optional(),
    category: z
      .enum(["validation", "provider", "quota", "timeout", "network", "unknown"])
      .optional(),
    durationMs: z.number().int().min(0).max(3600000).optional(),
  })
  .strict();
