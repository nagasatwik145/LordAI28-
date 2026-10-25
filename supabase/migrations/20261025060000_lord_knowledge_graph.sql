-- Durable, reviewable graph metadata on the existing knowledge graph tables.
-- Some deployed databases were created without the legacy Phase 2 migration
-- that originally introduced these tables. Bootstrap them here so this
-- migration can be applied safely to those databases as well.
CREATE TABLE IF NOT EXISTS public.knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  storage_path TEXT,
  content_text TEXT,
  mime_type TEXT,
  file_size_bytes INTEGER DEFAULT 0,
  page_count INTEGER,
  word_count INTEGER DEFAULT 0,
  language TEXT DEFAULT 'en',
  processing_status TEXT NOT NULL DEFAULT 'pending',
  processing_error TEXT,
  metadata JSONB DEFAULT '{}',
  chunk_count INTEGER DEFAULT 0,
  is_indexed BOOLEAN NOT NULL DEFAULT false,
  last_indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS knowledge_sources_project_id_idx
  ON public.knowledge_sources(project_id);
CREATE INDEX IF NOT EXISTS knowledge_sources_user_id_idx
  ON public.knowledge_sources(user_id);
CREATE INDEX IF NOT EXISTS knowledge_sources_processing_status_idx
  ON public.knowledge_sources(processing_status);
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.knowledge_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id UUID REFERENCES public.knowledge_sources(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'concept',
  name TEXT NOT NULL,
  description TEXT,
  embedding VECTOR(1536),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.knowledge_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES public.knowledge_entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.knowledge_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 1.0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entities_user_id
  ON public.knowledge_entities(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entities_type
  ON public.knowledge_entities(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_user_id
  ON public.knowledge_relations(user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_source
  ON public.knowledge_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_relations_target
  ON public.knowledge_relations(target_entity_id);

ALTER TABLE public.knowledge_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_relations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'knowledge_sources'
      AND policyname = 'Users manage own knowledge sources'
  ) THEN
    CREATE POLICY "Users manage own knowledge sources"
      ON public.knowledge_sources FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'knowledge_entities'
      AND policyname = 'Users can manage own knowledge entities'
  ) THEN
    CREATE POLICY "Users can manage own knowledge entities"
      ON public.knowledge_entities FOR ALL
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'knowledge_relations'
      AND policyname = 'Users can manage own knowledge relations'
  ) THEN
    CREATE POLICY "Users can manage own knowledge relations"
      ON public.knowledge_relations FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END;
$$;

ALTER TABLE public.knowledge_entities
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_identifier TEXT,
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

ALTER TABLE public.knowledge_relations
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_identifier TEXT,
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS is_inferred BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.knowledge_entities DROP CONSTRAINT IF EXISTS knowledge_entities_review_status_check;
ALTER TABLE public.knowledge_entities ADD CONSTRAINT knowledge_entities_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'dismissed'));
ALTER TABLE public.knowledge_relations DROP CONSTRAINT IF EXISTS knowledge_relations_review_status_check;
ALTER TABLE public.knowledge_relations ADD CONSTRAINT knowledge_relations_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'dismissed'));

UPDATE public.knowledge_entities SET normalized_name = lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
WHERE normalized_name IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_entities_user_source_name_idx
  ON public.knowledge_entities(user_id, source_type, source_identifier, normalized_name)
  WHERE source_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS knowledge_entities_user_review_idx
  ON public.knowledge_entities(user_id, review_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_relations_source_target_type_idx
  ON public.knowledge_relations(user_id, source_entity_id, target_entity_id, relation_type, source_identifier)
  WHERE source_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS knowledge_relations_user_review_idx
  ON public.knowledge_relations(user_id, review_status, created_at DESC);

-- Prevent cross-owner edges even when clients call PostgREST directly.
CREATE OR REPLACE FUNCTION public.validate_knowledge_graph_owners()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE source_owner UUID; target_owner UUID;
BEGIN
  SELECT user_id INTO source_owner FROM public.knowledge_entities WHERE id = NEW.source_entity_id;
  SELECT user_id INTO target_owner FROM public.knowledge_entities WHERE id = NEW.target_entity_id;
  IF source_owner IS DISTINCT FROM NEW.user_id OR target_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Knowledge graph entities must belong to relation owner';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_knowledge_graph_owners ON public.knowledge_relations;
CREATE TRIGGER validate_knowledge_graph_owners BEFORE INSERT OR UPDATE OF user_id, source_entity_id, target_entity_id
  ON public.knowledge_relations FOR EACH ROW EXECUTE FUNCTION public.validate_knowledge_graph_owners();
