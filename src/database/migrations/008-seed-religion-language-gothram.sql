-- ============================================================================
-- Seed reference data for language, religion, and gothram + add other fields
-- ============================================================================

-- Add other* columns to user profile if missing
ALTER TABLE public.ft_user_profile
  ADD COLUMN IF NOT EXISTS "otherReligion" VARCHAR(255);

ALTER TABLE public.ft_user_profile
  ADD COLUMN IF NOT EXISTS "otherLanguage" VARCHAR(255);

ALTER TABLE public.ft_user_profile
  ADD COLUMN IF NOT EXISTS "otherGothram" VARCHAR(255);

-- Seed languages only if table is empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ft_language) THEN
    INSERT INTO public.ft_language (name, "isoCode", status)
    VALUES
      ('Tamil', 'ta', 1),
      ('Hindi', 'hi', 1),
      ('Telugu', 'te', 1),
      ('Malayalam', 'ml', 1),
      ('Kannada', 'kn', 1),
      ('Marathi', 'mr', 1),
      ('Gujarati', 'gu', 1),
      ('Bengali', 'bn', 1),
      ('Punjabi', 'pa', 1),
      ('Urdu', 'ur', 1),
      ('Odia', 'or', 1),
      ('Assamese', 'as', 1),
      ('English', 'en', 1);
  END IF;
END $$;

-- Seed religions only if table is empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ft_religion) THEN
    INSERT INTO public.ft_religion (name, status)
    VALUES
      ('Hindu', 1),
      ('Muslim', 1),
      ('Christian', 1),
      ('Sikh', 1),
      ('Buddhist', 1),
      ('Jain', 1),
      ('Zoroastrian (Parsi)', 1);
  END IF;
END $$;

-- Seed gothrams only if table is empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ft_gothram) THEN
    INSERT INTO public.ft_gothram (name, status)
    VALUES
      ('Bharadwaja', 1),
      ('Kashyapa', 1),
      ('Vasishta', 1),
      ('Vishwamitra', 1),
      ('Gautama', 1),
      ('Agastya', 1),
      ('Jamadagni', 1),
      ('Atri', 1);
  END IF;
END $$;
