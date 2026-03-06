-- Add soft-delete support for galleries
-- Idempotent migration

ALTER TABLE IF EXISTS public.ft_gallery
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ NULL;

ALTER TABLE IF EXISTS public.ft_gallery
  ADD COLUMN IF NOT EXISTS "deletedByUserId" INTEGER NULL;

ALTER TABLE IF EXISTS public.ft_gallery
  ADD COLUMN IF NOT EXISTS "deletedByAdminId" INTEGER NULL;

CREATE INDEX IF NOT EXISTS "idx_ft_gallery_deletedAt" ON public.ft_gallery ("deletedAt");
