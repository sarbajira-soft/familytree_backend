-- Update ft_family_merge_request table to track primary and secondary family status separately
-- and store duplicate persons and conflict information

-- Step 1: Add new columns
ALTER TABLE ft_family_merge_request
ADD COLUMN IF NOT EXISTS "primaryStatus" VARCHAR(20) DEFAULT 'open',
ADD COLUMN IF NOT EXISTS "secondaryStatus" VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS "duplicatePersonsInfo" TEXT,
ADD COLUMN IF NOT EXISTS "conflictSummary" TEXT;

-- Step 2: Migrate existing data from old 'status' column to 'primaryStatus'
UPDATE ft_family_merge_request
SET "primaryStatus" = status
WHERE "primaryStatus" IS NULL OR "primaryStatus" = 'open';

-- Step 3: Drop old status column (optional - keep for backward compatibility during transition)
-- ALTER TABLE ft_family_merge_request DROP COLUMN IF EXISTS status;

-- Step 4: Create indexes for the new status columns
CREATE INDEX IF NOT EXISTS idx_family_merge_primary_status
ON ft_family_merge_request ("primaryStatus");

CREATE INDEX IF NOT EXISTS idx_family_merge_secondary_status
ON ft_family_merge_request ("secondaryStatus");

CREATE INDEX IF NOT EXISTS idx_family_merge_status_pair
ON ft_family_merge_request ("primaryStatus", "secondaryStatus");

-- Step 5: Add constraint to ensure valid status values
ALTER TABLE ft_family_merge_request
ADD CONSTRAINT check_primary_status CHECK ("primaryStatus" IN ('open', 'accepted', 'rejected', 'merged')),
ADD CONSTRAINT check_secondary_status CHECK ("secondaryStatus" IN ('pending', 'acknowledged', 'rejected', 'merged'));
