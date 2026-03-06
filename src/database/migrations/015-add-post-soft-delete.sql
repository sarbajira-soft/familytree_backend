-- Add soft-delete support for posts
-- Idempotent migration

ALTER TABLE IF EXISTS public.ft_post
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS "idx_ft_post_deletedAt" ON public.ft_post ("deletedAt");
