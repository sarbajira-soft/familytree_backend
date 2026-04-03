ALTER TABLE public.ft_user_profile
ADD COLUMN IF NOT EXISTS "contentVisibilitySettings" JSONB NOT NULL DEFAULT '{"posts": true, "albums": true, "events": true}'::jsonb;
