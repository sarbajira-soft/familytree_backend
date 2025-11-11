-- ============================================
-- COUNT APIs PERFORMANCE OPTIMIZATION INDEXES (MINIMAL VERSION)
-- Date: January 25, 2025
-- Purpose: Add only the most critical indexes that we know will work
-- Safe to run: Uses IF NOT EXISTS
-- ============================================

-- ============================================
-- 1. POST LIKE & COMMENT COUNT OPTIMIZATION
-- ============================================
CREATE INDEX IF NOT EXISTS idx_post_like_post_id 
ON ft_post_like("postId");

CREATE INDEX IF NOT EXISTS idx_post_comment_post_id 
ON ft_post_comment("postId");

-- ============================================
-- 2. GALLERY LIKE & COMMENT COUNT OPTIMIZATION
-- ============================================
CREATE INDEX IF NOT EXISTS idx_gallery_like_gallery_id 
ON ft_gallery_like("galleryId");

CREATE INDEX IF NOT EXISTS idx_gallery_comment_gallery_id 
ON ft_gallery_comment("galleryId");

-- ============================================
-- 3. EVENT QUERIES OPTIMIZATION
-- ============================================
CREATE INDEX IF NOT EXISTS idx_event_upcoming 
ON ft_event("familyCode", "eventDate");

-- ============================================
-- 4. FAMILY MEMBER STATS OPTIMIZATION
-- ============================================
CREATE INDEX IF NOT EXISTS idx_family_member_stats 
ON ft_family_members("familyCode", "approveStatus");

CREATE INDEX IF NOT EXISTS idx_user_profile_stats 
ON ft_user_profile("userId", gender, dob);

-- ============================================
-- ANALYZE TO UPDATE STATISTICS
-- ============================================
ANALYZE;
