ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS conversations_metadata_idx
  ON public.conversations USING GIN (metadata);
