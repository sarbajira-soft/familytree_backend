-- =====================================================
-- COMPLETE DATABASE SCHEMA FIX
-- Fix all ENUM and column issues across all tables
-- =====================================================

-- 1. FIX NOTIFICATIONS TABLE
-- =====================================================

-- Create notification status ENUM if it doesn't exist
DO $$ BEGIN
    CREATE TYPE notification_status_enum AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add status column to ft_notifications table
ALTER TABLE ft_notifications 
ADD COLUMN IF NOT EXISTS "status" notification_status_enum DEFAULT 'pending';

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ft_notifications_status ON ft_notifications("status");
CREATE INDEX IF NOT EXISTS idx_ft_notifications_type ON ft_notifications("type");

-- 2. FIX FAMILY TREE TABLE
-- =====================================================

-- Create life status ENUM if it doesn't exist
DO $$ BEGIN
    CREATE TYPE life_status_enum AS ENUM ('living', 'remembering');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Check if lifeStatus column exists and has correct type
DO $$ 
BEGIN
    -- Try to alter the column type if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'ft_family_tree' AND column_name = 'lifeStatus') THEN
        -- Update existing column to use the ENUM
        ALTER TABLE ft_family_tree 
        ALTER COLUMN "lifeStatus" TYPE life_status_enum USING "lifeStatus"::life_status_enum;
    ELSE
        -- Add the column if it doesn't exist
        ALTER TABLE ft_family_tree 
        ADD COLUMN "lifeStatus" life_status_enum DEFAULT 'living';
    END IF;
END $$;

-- 3. FIX FAMILY MEMBERS TABLE
-- =====================================================

-- Create approve status ENUM if it doesn't exist
DO $$ BEGIN
    CREATE TYPE approve_status_enum AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Check if approveStatus column exists and has correct type
DO $$ 
BEGIN
    -- Try to alter the column type if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'ft_family_members' AND column_name = 'approveStatus') THEN
        -- Update existing column to use the ENUM
        ALTER TABLE ft_family_members 
        ALTER COLUMN "approveStatus" TYPE approve_status_enum USING "approveStatus"::approve_status_enum;
    ELSE
        -- Add the column if it doesn't exist
        ALTER TABLE ft_family_members 
        ADD COLUMN "approveStatus" approve_status_enum DEFAULT 'pending';
    END IF;
END $$;

-- 4. FIX NOTIFICATION RECIPIENTS TABLE
-- =====================================================

-- Ensure all required columns exist
ALTER TABLE ft_notification_recipients 
ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN DEFAULT false;

ALTER TABLE ft_notification_recipients 
ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_ft_notification_recipients_user_read 
ON ft_notification_recipients("userId", "isRead");

CREATE INDEX IF NOT EXISTS idx_ft_notification_recipients_notification 
ON ft_notification_recipients("notificationId");

-- 5. ADD HELPFUL COMMENTS
-- =====================================================

COMMENT ON COLUMN ft_notifications."status" IS 'Status of the notification (pending, accepted, rejected)';
COMMENT ON COLUMN ft_notifications."type" IS 'Type of notification (FAMILY_ASSOCIATION_REQUEST, etc.)';
COMMENT ON COLUMN ft_family_tree."lifeStatus" IS 'Life status of the person (living, remembering)';
COMMENT ON COLUMN ft_family_members."approveStatus" IS 'Approval status for family membership (pending, approved, rejected)';

-- 6. VERIFY SCHEMA
-- =====================================================

-- Show all ENUM types created
SELECT typname, array_agg(enumlabel ORDER BY enumsortorder) as enum_values
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid 
WHERE typname IN ('notification_status_enum', 'life_status_enum', 'approve_status_enum')
GROUP BY typname;

-- Show column information for verification
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name IN ('ft_notifications', 'ft_family_tree', 'ft_family_members', 'ft_notification_recipients')
    AND column_name IN ('status', 'lifeStatus', 'approveStatus', 'isRead', 'readAt')
ORDER BY table_name, column_name;
