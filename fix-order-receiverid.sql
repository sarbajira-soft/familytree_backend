-- Fix Order receiverId field to allow NULL values
-- Run this SQL script in your database to fix the NOT NULL constraint issue

-- For PostgreSQL
ALTER TABLE ft_order ALTER COLUMN receiverId DROP NOT NULL;

-- For MySQL (if using MySQL)
-- ALTER TABLE ft_order MODIFY COLUMN receiverId INT NULL;

-- For SQLite (if using SQLite)
-- This might require recreating the table or using a different approach
-- as SQLite has limited ALTER TABLE support

-- After running this, you can create orders with null receiverId values 