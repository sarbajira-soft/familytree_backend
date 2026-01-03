-- User Profile Privacy (Private Account)

ALTER TABLE public.ft_user_profile
  ADD COLUMN IF NOT EXISTS "isPrivate" BOOLEAN NOT NULL DEFAULT FALSE;
