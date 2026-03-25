ALTER TABLE public.ft_user
  ADD COLUMN IF NOT EXISTS "emailHash" VARCHAR(64);

ALTER TABLE public.ft_user
  ADD COLUMN IF NOT EXISTS "mobileHash" VARCHAR(64);

ALTER TABLE public.ft_user
  ALTER COLUMN "email" TYPE TEXT;

ALTER TABLE public.ft_user
  ALTER COLUMN "mobile" TYPE TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ft_user_email_hash_unique
  ON public.ft_user ("emailHash")
  WHERE "emailHash" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ft_user_mobile_hash_unique
  ON public.ft_user ("mobileHash")
  WHERE "mobileHash" IS NOT NULL;

ALTER TABLE public.ft_user_profile
  ALTER COLUMN "dob" TYPE TEXT
  USING CASE
    WHEN "dob" IS NULL THEN NULL
    ELSE "dob"::text
  END;

ALTER TABLE public.ft_user_profile
  ALTER COLUMN "contactNumber" TYPE TEXT;

ALTER TABLE public.ft_user_profile
  ADD COLUMN IF NOT EXISTS "emailPrivacy" VARCHAR(16) NOT NULL DEFAULT 'FAMILY';

ALTER TABLE public.ft_user_profile
  ADD COLUMN IF NOT EXISTS "addressPrivacy" VARCHAR(16) NOT NULL DEFAULT 'FAMILY';

ALTER TABLE public.ft_user_profile
  ADD COLUMN IF NOT EXISTS "phonePrivacy" VARCHAR(16) NOT NULL DEFAULT 'FAMILY';
