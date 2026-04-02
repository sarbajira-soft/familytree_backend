ALTER TABLE public.ft_user_profile
  ADD COLUMN IF NOT EXISTS "contentPrivacySettings" JSONB NOT NULL DEFAULT '{}'::jsonb;
