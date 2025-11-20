-- Add per-family blocking fields to ft_family_members
ALTER TABLE ft_family_members
ADD COLUMN IF NOT EXISTS "isBlocked" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ft_family_members
ADD COLUMN IF NOT EXISTS "blockedByUserId" INTEGER NULL;

ALTER TABLE ft_family_members
ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMP NULL;

-- Helpful index for queries filtering by familyCode and isBlocked
CREATE INDEX IF NOT EXISTS idx_family_members_blocked
ON ft_family_members ("familyCode", "isBlocked");
