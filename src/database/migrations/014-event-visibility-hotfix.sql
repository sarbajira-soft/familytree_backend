-- Hotfix: ensure event family visibility column exists even if 013 ran before this field was added

ALTER TABLE public.ft_event
  ADD COLUMN IF NOT EXISTS "isVisibleToFamily" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ft_event_family_visibility
  ON public.ft_event("familyCode", "status", "isVisibleToFamily");
