-- Add soft-delete support for events
-- Idempotent migration

ALTER TABLE IF EXISTS public.ft_event
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "deletedByUserId" INTEGER NULL,
  ADD COLUMN IF NOT EXISTS "deletedByAdminId" INTEGER NULL;

CREATE INDEX IF NOT EXISTS "idx_ft_event_deletedAt" ON public.ft_event ("deletedAt");
