CREATE TABLE IF NOT EXISTS public.study_focus_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('countdown', 'pomodoro', 'stopwatch')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'interrupted')),
  subject TEXT CHECK (subject IS NULL OR char_length(subject) <= 100),
  label TEXT CHECK (label IS NULL OR char_length(label) <= 160),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 0 AND 604800),
  planned_seconds INTEGER CHECK (planned_seconds IS NULL OR planned_seconds BETWEEN 1 AND 86400),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS study_focus_sessions_user_completed_idx
  ON public.study_focus_sessions (user_id, completed_at DESC);

ALTER TABLE public.study_focus_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Study focus sessions belong to user" ON public.study_focus_sessions;
CREATE POLICY "Study focus sessions belong to user"
  ON public.study_focus_sessions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON public.study_focus_sessions TO authenticated;
