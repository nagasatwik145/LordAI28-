ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS source_conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmation_status TEXT,
  ADD COLUMN IF NOT EXISTS use_in_context BOOLEAN,
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE;

UPDATE public.memories
SET confirmation_status = COALESCE(
      confirmation_status,
      CASE WHEN source = 'auto' THEN 'suggested' ELSE 'confirmed' END
    ),
    use_in_context = COALESCE(use_in_context, source <> 'auto')
WHERE confirmation_status IS NULL OR use_in_context IS NULL;

ALTER TABLE public.memories
  ALTER COLUMN confirmation_status SET DEFAULT 'suggested',
  ALTER COLUMN confirmation_status SET NOT NULL,
  ALTER COLUMN use_in_context SET DEFAULT false,
  ALTER COLUMN use_in_context SET NOT NULL;

ALTER TABLE public.memories
  DROP CONSTRAINT IF EXISTS memories_confirmation_status_check;
ALTER TABLE public.memories
  ADD CONSTRAINT memories_confirmation_status_check
  CHECK (confirmation_status IN ('suggested', 'confirmed'));

CREATE INDEX IF NOT EXISTS memories_user_project_confirmed_idx
  ON public.memories (user_id, project_id, confirmation_status, created_at DESC)
  WHERE archived = false;
CREATE INDEX IF NOT EXISTS memories_source_conversation_idx
  ON public.memories (user_id, source_conversation_id)
  WHERE source_conversation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_memory_graph_references()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  reference_owner UUID;
  source_project_id UUID;
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    SELECT p.user_id INTO reference_owner
    FROM public.projects p
    WHERE p.id = NEW.project_id;

    IF reference_owner IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Memory project must belong to the memory owner';
    END IF;
  END IF;

  IF NEW.source_conversation_id IS NOT NULL THEN
    SELECT c.user_id, c.project_id INTO reference_owner, source_project_id
    FROM public.conversations c
    WHERE c.id = NEW.source_conversation_id;

    IF reference_owner IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Memory source conversation must belong to the memory owner';
    END IF;

    IF NEW.project_id IS NULL THEN
      NEW.project_id := source_project_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_memory_graph_references ON public.memories;
CREATE TRIGGER validate_memory_graph_references
  BEFORE INSERT OR UPDATE OF project_id, source_conversation_id, user_id
  ON public.memories
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_memory_graph_references();

CREATE OR REPLACE FUNCTION public.enforce_memory_collection_setting()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE((
    SELECT ms.memory_enabled
    FROM public.memory_settings ms
    WHERE ms.user_id = NEW.user_id
  ), true) = false THEN
    RAISE EXCEPTION 'Memory collection is disabled for this user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_memory_collection_setting ON public.memories;
CREATE TRIGGER enforce_memory_collection_setting
  BEFORE INSERT ON public.memories
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_memory_collection_setting();

CREATE OR REPLACE FUNCTION public.touch_memory_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  affected_user_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.memory_settings
    SET updated_at = now()
    WHERE user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  affected_user_id := NEW.user_id;
  INSERT INTO public.memory_settings (user_id, updated_at)
  VALUES (affected_user_id, now())
  ON CONFLICT (user_id) DO UPDATE SET updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_memory_settings_updated_at ON public.memories;
CREATE TRIGGER touch_memory_settings_updated_at
  AFTER INSERT OR UPDATE OR DELETE ON public.memories
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_memory_settings_updated_at();

CREATE OR REPLACE FUNCTION public.match_memories(
  p_user_id UUID,
  p_embedding JSONB,
  p_limit INT DEFAULT 8,
  p_categories TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  category TEXT,
  pinned BOOLEAN,
  confidence DOUBLE PRECISION,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid()
     OR COALESCE((
       SELECT ms.memory_enabled
       FROM public.memory_settings ms
       WHERE ms.user_id = p_user_id
     ), true) = false THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'embedding_vec'
  ) THEN
    RETURN QUERY
    SELECT m.id, m.content, m.category, m.pinned, m.confidence,
      1 - (m.embedding_vec <=> (p_embedding #>> '{}')::vector) AS similarity
    FROM public.memories m
    WHERE m.user_id = p_user_id
      AND m.archived = false
      AND m.confirmation_status = 'confirmed'
      AND m.use_in_context = true
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND m.embedding_vec IS NOT NULL
      AND (p_categories IS NULL OR m.category = ANY(p_categories))
    ORDER BY m.embedding_vec <=> (p_embedding #>> '{}')::vector
    LIMIT LEAST(GREATEST(p_limit, 0), 50);
  ELSE
    RETURN QUERY
    SELECT m.id, m.content, m.category, m.pinned, m.confidence, 0.0::FLOAT AS similarity
    FROM public.memories m
    WHERE m.user_id = p_user_id
      AND m.archived = false
      AND m.confirmation_status = 'confirmed'
      AND m.use_in_context = true
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND (p_categories IS NULL OR m.category = ANY(p_categories))
    ORDER BY m.pinned DESC, m.importance DESC, m.created_at DESC
    LIMIT LEAST(GREATEST(p_limit, 0), 50);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_memories_by_project(
  p_user_id UUID,
  p_project_id UUID,
  p_embedding JSONB,
  p_limit INT DEFAULT 8
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  category TEXT,
  pinned BOOLEAN,
  confidence DOUBLE PRECISION,
  importance DOUBLE PRECISION,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid()
     OR COALESCE((
       SELECT ms.memory_enabled
       FROM public.memory_settings ms
       WHERE ms.user_id = p_user_id
     ), true) = false THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'embedding_vec'
  ) THEN
    RETURN QUERY
    SELECT m.id, m.content, m.category, m.pinned, m.confidence, m.importance,
      1 - (m.embedding_vec <=> (p_embedding #>> '{}')::vector) AS similarity
    FROM public.memories m
    WHERE m.user_id = p_user_id
      AND m.project_id = p_project_id
      AND m.archived = false
      AND m.confirmation_status = 'confirmed'
      AND m.use_in_context = true
      AND (m.expires_at IS NULL OR m.expires_at > now())
      AND m.embedding_vec IS NOT NULL
    ORDER BY m.embedding_vec <=> (p_embedding #>> '{}')::vector
    LIMIT LEAST(GREATEST(p_limit, 0), 50);
  ELSE
    RETURN QUERY
    SELECT m.id, m.content, m.category, m.pinned, m.confidence, m.importance, 0.0::FLOAT
    FROM public.memories m
    WHERE m.user_id = p_user_id
      AND m.project_id = p_project_id
      AND m.archived = false
      AND m.confirmation_status = 'confirmed'
      AND m.use_in_context = true
      AND (m.expires_at IS NULL OR m.expires_at > now())
    ORDER BY m.pinned DESC, m.importance DESC, m.created_at DESC
    LIMIT LEAST(GREATEST(p_limit, 0), 50);
  END IF;
END;
$$;
