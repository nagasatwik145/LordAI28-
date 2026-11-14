/** Public Fish Audio reference IDs; API credentials remain server-only. */
export type FishVoiceCategory = "assistant" | "feminine" | "masculine" | "character" | "other";

export interface FishVoice {
  id: string;
  name: string;
  description: string;
  category: FishVoiceCategory;
  is_default?: boolean;
}

export const FISH_VOICES = [
  {
    id: "da33a7e30cb847c0a4be8278dc107e7e",
    name: "Lord Default Voice",
    description: "The default LORD voice for new users and sessions.",
    category: "assistant",
    is_default: true,
  },
  {
    id: "9de091e13a954983acda089d1c3e83ec",
    name: "Lord-Tutor",
    description: "Optimized for tutoring and educational content.",
    category: "assistant",
    is_default: false,
  },
  {
    id: "b5b2d75e20714cea8a93411b36bda311",
    name: "Potato",
    description: "An optional assistant voice for variety.",
    category: "assistant",
    is_default: false,
  },
] as const;

export const LORD_DEFAULT_VOICE_ID = FISH_VOICES[0].id;

export function isFishVoiceIdFormat(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{32}$/i.test(value);
}
