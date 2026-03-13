ALTER TABLE public.ft_post
  ADD COLUMN IF NOT EXISTS "isVisibleToPublic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "hiddenReason" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "recoveryFamilyCode" VARCHAR(32);

ALTER TABLE public.ft_gallery
  ADD COLUMN IF NOT EXISTS "isVisibleToPublic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "hiddenReason" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "recoveryFamilyCode" VARCHAR(32);

ALTER TABLE public.ft_event
  ADD COLUMN IF NOT EXISTS "hiddenReason" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "recoveryFamilyCode" VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_ft_post_public_visibility
  ON public.ft_post (privacy, "isVisibleToPublic", "hiddenReason");

CREATE INDEX IF NOT EXISTS idx_ft_gallery_public_visibility
  ON public.ft_gallery (privacy, "isVisibleToPublic", "hiddenReason");

CREATE INDEX IF NOT EXISTS idx_ft_post_recovery_family
  ON public.ft_post ("createdBy", "recoveryFamilyCode", "hiddenReason");

CREATE INDEX IF NOT EXISTS idx_ft_gallery_recovery_family
  ON public.ft_gallery ("createdBy", "recoveryFamilyCode", "hiddenReason");

CREATE INDEX IF NOT EXISTS idx_ft_event_recovery_family
  ON public.ft_event ("createdBy", "recoveryFamilyCode", "hiddenReason");
