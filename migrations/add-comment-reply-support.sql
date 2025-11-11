-- Migration: Add reply support to comments
-- Date: 2024
-- Description: Adds parentCommentId field to support nested comment replies

-- Add parentCommentId to ft_gallery_comment table (check if column exists first)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ft_gallery_comment' 
        AND column_name = 'parentCommentId'
    ) THEN
        ALTER TABLE ft_gallery_comment 
        ADD COLUMN "parentCommentId" INTEGER NULL;
    END IF;
END $$;

-- Add parentCommentId to ft_post_comment table (check if column exists first)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ft_post_comment' 
        AND column_name = 'parentCommentId'
    ) THEN
        ALTER TABLE ft_post_comment 
        ADD COLUMN "parentCommentId" INTEGER NULL;
    END IF;
END $$;

-- Add foreign key constraint for gallery comments (self-referencing)
-- First, drop the constraint if it exists to avoid conflicts
ALTER TABLE ft_gallery_comment DROP CONSTRAINT IF EXISTS fk_gallery_comment_parent;

-- Then add the constraint
ALTER TABLE ft_gallery_comment
ADD CONSTRAINT fk_gallery_comment_parent
FOREIGN KEY ("parentCommentId") 
REFERENCES ft_gallery_comment(id) 
ON DELETE CASCADE;

-- Add foreign key constraint for post comments (self-referencing)
-- First, drop the constraint if it exists to avoid conflicts
ALTER TABLE ft_post_comment DROP CONSTRAINT IF EXISTS fk_post_comment_parent;

-- Then add the constraint
ALTER TABLE ft_post_comment
ADD CONSTRAINT fk_post_comment_parent
FOREIGN KEY ("parentCommentId") 
REFERENCES ft_post_comment(id) 
ON DELETE CASCADE;

-- Add index for better query performance on gallery comments
CREATE INDEX IF NOT EXISTS idx_gallery_comment_parent 
ON ft_gallery_comment("parentCommentId");

-- Add index for better query performance on post comments
CREATE INDEX IF NOT EXISTS idx_post_comment_parent 
ON ft_post_comment("parentCommentId");

-- Update updatedAt column for ft_post_comment if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ft_post_comment' 
        AND column_name = 'updatedAt'
    ) THEN
        ALTER TABLE ft_post_comment 
        ADD COLUMN "updatedAt" TIMESTAMP DEFAULT NOW();
    END IF;
END $$;

-- Comments for documentation
COMMENT ON COLUMN ft_gallery_comment."parentCommentId" IS 'Reference to parent comment for nested replies';
COMMENT ON COLUMN ft_post_comment."parentCommentId" IS 'Reference to parent comment for nested replies';
