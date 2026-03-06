-- Add audit fields for post deletion (who deleted)
-- Idempotent migration

ALTER TABLE IF EXISTS public.ft_post
  ADD COLUMN IF NOT EXISTS "deletedByUserId" INTEGER NULL;

ALTER TABLE IF EXISTS public.ft_post
  ADD COLUMN IF NOT EXISTS "deletedByAdminId" INTEGER NULL;

CREATE INDEX IF NOT EXISTS "idx_ft_post_deletedByUserId" ON public.ft_post ("deletedByUserId");
CREATE INDEX IF NOT EXISTS "idx_ft_post_deletedByAdminId" ON public.ft_post ("deletedByAdminId");
