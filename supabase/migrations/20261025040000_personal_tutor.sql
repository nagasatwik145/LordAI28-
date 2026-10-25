CREATE TABLE IF NOT EXISTS public.personal_tutor_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  topic text NOT NULL,
  prompt text NOT NULL,
  choices jsonb NOT NULL,
  correct_index integer NOT NULL CHECK (correct_index >= 0 AND correct_index < 6),
  hint text NOT NULL,
  explanation text NOT NULL,
  difficulty integer NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  is_correct boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz
);
CREATE INDEX IF NOT EXISTS personal_tutor_questions_user_recent_idx
  ON public.personal_tutor_questions(user_id, created_at DESC);
ALTER TABLE public.personal_tutor_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personal_tutor_questions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_tutor_questions TO service_role;

CREATE TABLE IF NOT EXISTS public.personal_tutor_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text,
  topic text,
  weekly_goal_minutes integer NOT NULL DEFAULT 120 CHECK (weekly_goal_minutes BETWEEN 15 AND 1680),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.personal_tutor_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own tutor preferences" ON public.personal_tutor_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_tutor_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_tutor_preferences TO service_role;

CREATE TABLE IF NOT EXISTS public.personal_tutor_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.personal_tutor_questions(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.personal_tutor_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personal_tutor_reports FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_tutor_reports TO service_role;
