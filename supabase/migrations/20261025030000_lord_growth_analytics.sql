-- Opt-in, minimized product analytics. Operational logs remain in application logs.
CREATE TABLE IF NOT EXISTS public.analytics_consents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.analytics_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_consents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.analytics_consents TO authenticated;
CREATE POLICY "Users manage own analytics consent" ON public.analytics_consents
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.product_analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (event_name IN (
    'onboarding_started','onboarding_completed','feature_tour_completed','feature_opened',
    'chat_succeeded','chat_failed','study_session_completed','game_generation_succeeded',
    'game_generation_failed','mission_completed','mission_failed',
    'subscription_checkout_initiated','subscription_checkout_confirmed'
  )),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  dedupe_key text,
  feature text,
  category text,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_analytics_created_idx ON public.product_analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS product_analytics_name_created_idx ON public.product_analytics_events(event_name, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS product_analytics_dedupe_idx
  ON public.product_analytics_events(user_id, event_name, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
ALTER TABLE public.product_analytics_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_analytics_events FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.product_analytics_events TO service_role;

-- Bounded retention for product analytics; run daily from the deployment scheduler.
CREATE OR REPLACE FUNCTION public.purge_product_analytics()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE removed bigint;
BEGIN
  DELETE FROM public.product_analytics_events WHERE created_at < now() - interval '13 months';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_product_analytics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_product_analytics() TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_action_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('reset', 'reload-env')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_action_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_action_audit FROM anon, authenticated;
GRANT INSERT, SELECT ON public.admin_action_audit TO service_role;
