

ALTER TABLE IF EXISTS public.ft_tree_link_request
  ADD COLUMN IF NOT EXISTS "parentRole" VARCHAR(20);