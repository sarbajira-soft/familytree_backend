-- Fix Gallery familyCode field to allow NULL values
-- Run this SQL script in your database to fix the NOT NULL constraint issue

-- For PostgreSQL
ALTER TABLE ft_gallery ALTER COLUMN familyCode DROP NOT NULL;

-- For MySQL (if using MySQL)
-- ALTER TABLE ft_gallery MODIFY COLUMN familyCode VARCHAR(255) NULL;

-- For SQLite (if using SQLite)
-- This might require recreating the table or using a different approach
-- as SQLite has limited ALTER TABLE support

-- After running this, you can revert the service code changes
-- and use null values instead of empty strings for public galleries 