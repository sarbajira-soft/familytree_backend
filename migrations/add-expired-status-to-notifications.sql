-- Migration: Add 'expired' status to notifications
-- Date: 2025-01-26
-- Purpose: Support auto-expiry of old family association requests

-- Step 1: Add 'expired' to the status enum
ALTER TYPE "enum_ft_notifications_status" ADD VALUE IF NOT EXISTS 'expired';

-- Step 2: Add index for efficient expiry queries
CREATE INDEX IF NOT EXISTS idx_notifications_type_status_created 
ON ft_notifications(type, status, "createdAt");

-- Step 3: Add comment for documentation
COMMENT ON COLUMN ft_notifications.status IS 'Notification status: pending, accepted, rejected, or expired (auto-expired after 15 days for association requests)';

-- Verification query
SELECT 
    enumlabel as status_value
FROM pg_enum 
WHERE enumtypid = (
    SELECT oid 
    FROM pg_type 
    WHERE typname = 'enum_ft_notifications_status'
)
ORDER BY enumsortorder;
