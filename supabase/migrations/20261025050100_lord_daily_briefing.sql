ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS briefing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS briefing_time time NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS briefing_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS briefing_dismissed jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS briefing_focus text NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';
