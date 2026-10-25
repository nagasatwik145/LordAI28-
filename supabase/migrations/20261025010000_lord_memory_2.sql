ALTER TABLE public.memory_settings
  ADD COLUMN IF NOT EXISTS personalization_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS memories_user_project_retrieval_idx
  ON public.memories (user_id, project_id, updated_at DESC)
  WHERE archived = false
    AND confirmation_status = 'confirmed'
    AND use_in_context = true;
