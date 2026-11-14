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
  ('da33a7e30cb847c0a4be8278dc107e7e', 'Lord Default Voice', 'The default LORD voice for new users and sessions.', 'assistant', true),
  ('9de091e13a954983acda089d1c3e83ec', 'Lord-Tutor', 'Optimized for tutoring and educational content.', 'assistant', false),
  ('b5b2d75e20714cea8a93411b36bda311', 'Potato', 'An optional assistant voice for variety.', 'assistant', false)
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
