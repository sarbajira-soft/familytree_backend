-- Sprint-I deletion lifecycle and visibility controls

ALTER TABLE public.ft_user
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "purgeAfter" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "lifecycleState" VARCHAR(32) NOT NULL DEFAULT 'active';

ALTER TABLE public.ft_gallery
  ADD COLUMN IF NOT EXISTS "isVisibleToFamily" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.ft_post
  ADD COLUMN IF NOT EXISTS "isVisibleToFamily" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.ft_event
  ADD COLUMN IF NOT EXISTS "isVisibleToFamily" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.ft_account_recovery_token (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "tokenHash" VARCHAR(255) NOT NULL,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "usedAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_account_recovery_token_user
    FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ft_account_recovery_token_user ON public.ft_account_recovery_token("userId");
CREATE INDEX IF NOT EXISTS idx_ft_account_recovery_token_hash ON public.ft_account_recovery_token("tokenHash");
CREATE INDEX IF NOT EXISTS idx_ft_user_deleted_at ON public.ft_user("deletedAt");
CREATE INDEX IF NOT EXISTS idx_ft_user_purge_after ON public.ft_user("purgeAfter");
CREATE INDEX IF NOT EXISTS idx_ft_gallery_family_visibility ON public.ft_gallery("familyCode", "privacy", "isVisibleToFamily");
CREATE INDEX IF NOT EXISTS idx_ft_post_family_visibility ON public.ft_post("familyCode", "privacy", "isVisibleToFamily");
CREATE INDEX IF NOT EXISTS idx_ft_event_family_visibility ON public.ft_event("familyCode", "status", "isVisibleToFamily");
