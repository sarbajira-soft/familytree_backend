-- Create ENUM type for notification status
CREATE TYPE notification_status_enum AS ENUM ('pending', 'accepted', 'rejected');

-- Add status column to ft_notifications table
ALTER TABLE ft_notifications 
ADD COLUMN IF NOT EXISTS "status" notification_status_enum DEFAULT 'pending';

-- Add comment for documentation
COMMENT ON COLUMN ft_notifications."status" IS 'Status of the notification (pending, accepted, rejected)';
