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
  it("keeps the existing LORD voice as the immutable default catalog entry", () => {
    expect(FISH_VOICES[0].id).toBe(LORD_DEFAULT_VOICE_ID);
    expect(FISH_VOICES[0].is_default).toBe(true);
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
