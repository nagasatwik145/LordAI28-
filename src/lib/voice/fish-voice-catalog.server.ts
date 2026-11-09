import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FISH_VOICES, type FishVoice } from "./fish-voice-catalog";

export async function getTrustedFishVoices(): Promise<FishVoice[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("fish_voice_catalog")
      .select("id, name, description, category, is_default")
      .order("is_default", { ascending: false })
      .order("name", { ascending: true });

    if (error || !data) {
      console.error("[fish-voice-catalog] Could not load trusted voice catalog", error?.message);
      return FISH_VOICES.map((voice) => ({ ...voice }));
    }
    return data as FishVoice[];
  } catch (error) {
    console.error("[fish-voice-catalog] Could not load trusted voice catalog", error);
    return FISH_VOICES.map((voice) => ({ ...voice }));
  }
}

export async function isTrustedFishVoiceId(value: unknown): Promise<boolean> {
  if (typeof value !== "string") return false;
  try {
    const { data, error } = await supabaseAdmin
      .from("fish_voice_catalog")
      .select("id")
      .eq("id", value)
      .maybeSingle();
    if (error) return FISH_VOICES.some((voice) => voice.id === value);
    return Boolean(data);
  } catch {
    return FISH_VOICES.some((voice) => voice.id === value);
  }
}
