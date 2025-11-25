-- Fix accessToken column to support longer JWT tokens
-- Change from VARCHAR(255) to TEXT to accommodate JWT tokens that exceed 255 characters

ALTER TABLE ft_user
ALTER COLUMN "accessToken" TYPE TEXT;
