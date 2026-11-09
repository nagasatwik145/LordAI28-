CREATE TABLE IF NOT EXISTS public.fish_voice_catalog (
  id text PRIMARY KEY CHECK (id ~ '^[a-fA-F0-9]{32}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  category text NOT NULL CHECK (category IN ('assistant', 'feminine', 'masculine', 'character', 'other')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fish_voice_catalog_one_default
  ON public.fish_voice_catalog (is_default) WHERE is_default;

ALTER TABLE public.fish_voice_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fish_voice_catalog FROM anon, authenticated;
GRANT ALL ON public.fish_voice_catalog TO service_role;

INSERT INTO public.fish_voice_catalog (id, name, description, category, is_default)
VALUES
  ('3b236efc60e64de29578815a59070170', 'LORD', 'The original LORD voice. Kept as the default for existing users.', 'assistant', true),
  ('933563129e564b19a115bedd57b7406a', 'Sarah', 'A clear, warm voice from Fish Audio’s official S2.1 Pro example.', 'feminine', false)
ON CONFLICT (id) DO NOTHING;

UPDATE public.user_settings settings
SET voice_id = NULL
WHERE settings.voice_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.fish_voice_catalog voices WHERE voices.id = settings.voice_id
  );

ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_voice_id_fkey,
  ADD CONSTRAINT user_settings_voice_id_fkey
    FOREIGN KEY (voice_id) REFERENCES public.fish_voice_catalog(id) ON DELETE SET NULL;
