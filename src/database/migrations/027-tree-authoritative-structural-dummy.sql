ALTER TABLE IF EXISTS public.ft_family_tree
  ADD COLUMN IF NOT EXISTS "isStructuralDummy" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.ft_family_tree
  ADD COLUMN IF NOT EXISTS "nodeType" VARCHAR(32) NOT NULL DEFAULT 'birth';

ALTER TABLE IF EXISTS public.ft_family_tree
  ADD COLUMN IF NOT EXISTS "dummyReason" VARCHAR(255);

ALTER TABLE IF EXISTS public.ft_family_tree
  ADD COLUMN IF NOT EXISTS "dummyCreatedAt" TIMESTAMP;

ALTER TABLE IF EXISTS public.ft_family_tree
  ADD COLUMN IF NOT EXISTS "dummyCreatedBy" INTEGER;

ALTER TABLE IF EXISTS public.ft_family
  ADD COLUMN IF NOT EXISTS "treeVersion" INTEGER NOT NULL DEFAULT 0;

UPDATE public.ft_family_tree
SET "nodeType" = CASE
  WHEN COALESCE("isStructuralDummy", false) = true THEN 'structural_dummy'
  WHEN COALESCE("isExternalLinked", false) = true THEN 'linked'
  ELSE COALESCE(NULLIF(TRIM("nodeType"), ''), 'birth')
END;

CREATE INDEX IF NOT EXISTS idx_ft_family_tree_structural_dummy
  ON public.ft_family_tree ("familyCode", "isStructuralDummy");

CREATE INDEX IF NOT EXISTS idx_ft_family_tree_node_type
  ON public.ft_family_tree ("familyCode", "nodeType");
