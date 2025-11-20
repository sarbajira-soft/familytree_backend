-- Add treeVersion column to ft_family for optimistic locking of family trees
ALTER TABLE ft_family
ADD COLUMN IF NOT EXISTS "treeVersion" INTEGER DEFAULT 0;
