-- Add soft-delete support for comments (post + gallery)
-- Idempotent migration

ALTER TABLE IF EXISTS public.ft_post_comment
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ NULL;

ALTER TABLE IF EXISTS public.ft_post_comment
  ADD COLUMN IF NOT EXISTS "deletedByUserId" INTEGER NULL;

ALTER TABLE IF EXISTS public.ft_post_comment
  ADD COLUMN IF NOT EXISTS "deletedByAdminId" INTEGER NULL;

CREATE INDEX IF NOT EXISTS "idx_ft_post_comment_deletedAt" ON public.ft_post_comment ("deletedAt");

ALTER TABLE IF EXISTS public.ft_gallery_comment
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ NULL;

ALTER TABLE IF EXISTS public.ft_gallery_comment
  ADD COLUMN IF NOT EXISTS "deletedByUserId" INTEGER NULL;

ALTER TABLE IF EXISTS public.ft_gallery_comment
  ADD COLUMN IF NOT EXISTS "deletedByAdminId" INTEGER NULL;

CREATE INDEX IF NOT EXISTS "idx_ft_gallery_comment_deletedAt" ON public.ft_gallery_comment ("deletedAt");
