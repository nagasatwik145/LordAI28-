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
    id: "3b236efc60e64de29578815a59070170",
    name: "LORD",
    description: "The original LORD voice. Kept as the default for existing users.",
    category: "assistant",
    is_default: true,
  },
  {
    id: "933563129e564b19a115bedd57b7406a",
    name: "Sarah",
    description: "A clear, warm voice from Fish Audio’s official S2.1 Pro example.",
    category: "feminine",
    is_default: false,
  },
] as const;

export const LORD_DEFAULT_VOICE_ID = FISH_VOICES[0].id;

export function isFishVoiceIdFormat(value: unknown): value is string {
  return typeof value === "string" && /^[a-f\d]{32}$/i.test(value);
}
