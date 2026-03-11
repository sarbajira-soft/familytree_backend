-- Migration: Add removedAt and removedBy columns to ft_family_members
-- These are needed for soft-delete member removal tracking

DO $$
BEGIN
    -- Add removedAt column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ft_family_members' 
        AND column_name = 'removedAt'
    ) THEN
        ALTER TABLE "ft_family_members" 
        ADD COLUMN "removedAt" TIMESTAMP WITH TIME ZONE;
        
        RAISE NOTICE 'Added removedAt column to ft_family_members';
    END IF;

    -- Add removedBy column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ft_family_members' 
        AND column_name = 'removedBy'
    ) THEN
        ALTER TABLE "ft_family_members" 
        ADD COLUMN "removedBy" INTEGER;
        
        RAISE NOTICE 'Added removedBy column to ft_family_members';
    END IF;
END $$;

-- Add index for performance on removed status queries
CREATE INDEX IF NOT EXISTS "idx_ft_family_members_removed_at" 
ON "ft_family_members"("removedAt");

CREATE INDEX IF NOT EXISTS "idx_ft_family_members_removed_by" 
ON "ft_family_members"("removedBy");
