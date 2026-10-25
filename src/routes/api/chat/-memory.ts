import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildBrainContext, type BrainContextOptions } from "@/lib/brain/context";
import { isMemoryEnabled } from "@/lib/memory/types";

export async function buildMemoryPrompt(
  supabase: SupabaseClient<Database>,
  userId: string,
  query: string,
  projectId?: string | null,
): Promise<string> {
  try {
    const { data: settings, error: settingsError } = await supabase
      .from("memory_settings")
      .select("memory_enabled,personalization_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (
      settingsError ||
      !isMemoryEnabled(settings) ||
      settings?.personalization_enabled === false
    ) {
      return "";
    }

    const opts: BrainContextOptions = {
      userId,
      projectId: projectId ?? null,
      query,
      maxMemories: 8,
      maxKnowledgeChunks: 3,
      maxRecentChats: 3,
      includePinnedNotes: true,
      includeRecentTasks: false,
      tokenBudget: 800,
    };
    const result = await buildBrainContext(opts, supabase);
    return result.systemPromptSnippet;
  } catch {
    return "";
  }
}
