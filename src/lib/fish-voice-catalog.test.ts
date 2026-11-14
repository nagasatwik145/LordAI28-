import { describe, expect, it } from "vitest";
import {
  requireHealthCenterAdmin,
  requireSupabaseRequestAuth,
} from "@/integrations/supabase/auth-middleware";
import {
  FISH_VOICES,
  LORD_DEFAULT_VOICE_ID,
  isFishVoiceIdFormat,
} from "@/lib/voice/fish-voice-catalog";
import { Route as catalogRoute } from "@/routes/api/voice/catalog";
import { Route as catalogManageRoute } from "@/routes/api/voice/catalog/manage";

describe("Fish Audio Voice Studio catalog", () => {
  it("keeps the Lord Default Voice as the immutable default catalog entry", () => {
    expect(FISH_VOICES[0].id).toBe(LORD_DEFAULT_VOICE_ID);
    expect(FISH_VOICES[0].name).toBe("Lord Default Voice");
    expect(FISH_VOICES[0].is_default).toBe(true);
  });

  it("has Lord-Tutor and Potato voices with correct IDs", () => {
    expect(FISH_VOICES[1].name).toBe("Lord-Tutor");
    expect(FISH_VOICES[1].id).toBe("9de091e13a954983acda089d1c3e83ec");
    expect(FISH_VOICES[2].name).toBe("Potato");
    expect(FISH_VOICES[2].id).toBe("b5b2d75e20714cea8a93411b36bda311");
  });

  it("accepts Fish Audio reference ID format and rejects arbitrary values", () => {
    expect(isFishVoiceIdFormat(LORD_DEFAULT_VOICE_ID)).toBe(true);
    expect(isFishVoiceIdFormat("not-a-voice-id")).toBe(false);
  });

  it("allows authenticated catalog reads but gates management behind admin middleware", () => {
    expect(catalogRoute.options.server?.middleware).toContain(requireSupabaseRequestAuth);
    expect(catalogManageRoute.options.server?.middleware).toContain(requireHealthCenterAdmin);
  });
});
