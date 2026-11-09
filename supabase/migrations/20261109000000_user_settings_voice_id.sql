ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS voice_id text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
