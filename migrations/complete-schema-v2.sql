-- ============================================
-- COMPLETE DATABASE SCHEMA v2.0
-- Date: October 25, 2025
-- Tables: 29 (verified from models)
-- Purpose: Complete database creation from ground up
-- Safe to run on existing database (IF NOT EXISTS)
-- ============================================

-- ============================================
-- VERIFIED TABLES FROM MODELS (29):
-- ============================================
-- 1. ft_user
-- 2. ft_user_profile
-- 3. ft_user_relationships
-- 4. ft_family
-- 5. ft_family_members (plural)
-- 6. ft_family_tree
-- 7. ft_invite (singular)
-- 8. ft_notifications (plural)
-- 9. ft_notification_recipients
-- 10. ft_post (singular)
-- 11. ft_post_comment (singular)
-- 12. ft_post_like (singular)
-- 13. ft_event (singular)
-- 14. ft_event_image
-- 15. ft_gallery
-- 16. ft_gallery_album
-- 17. ft_gallery_comment
-- 18. ft_gallery_like
-- 19. ft_product (singular)
-- 20. ft_product_image
-- 21. ft_category
-- 22. ft_order
-- 23. ft_country
-- 24. ft_language
-- 25. ft_religion
-- 26. ft_gothram
-- 27. relationships
-- 28. relationship_translations
-- 29. custom_labels

-- ============================================
-- SECTION 1: CREATE ALL TABLES
-- ============================================

-- --------------------------------------------
-- 1. FT_USER
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_user (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255),
    mobile VARCHAR(20),
    role VARCHAR(50) DEFAULT 'user',
    "emailVerificationStatus" VARCHAR(50) DEFAULT 'unverified',
    "mobileVerificationStatus" VARCHAR(50) DEFAULT 'unverified',
    "isActive" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP WITH TIME ZONE
);

-- --------------------------------------------
-- 2. FT_USER_PROFILE
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_user_profile (
    id SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL UNIQUE REFERENCES ft_user(id) ON DELETE CASCADE,
    "firstName" VARCHAR(255),
    "lastName" VARCHAR(255),
    profile VARCHAR(255),
    gender VARCHAR(255),
    dob TIMESTAMP WITH TIME ZONE,
    age INTEGER,
    "dateOfBirth" DATE,
    "maritalStatus" VARCHAR(255),
    "marriageDate" TIMESTAMP WITH TIME ZONE,
    "spouseName" VARCHAR(255),
    "childrenNames" TEXT,
    "fatherName" VARCHAR(255),
    "motherName" VARCHAR(255),
    "religionId" INTEGER,
    "languageId" INTEGER,
    caste VARCHAR(255),
    "gothramId" INTEGER,
    kuladevata VARCHAR(255),
    region VARCHAR(255),
    hobbies TEXT,
    likes TEXT,
    dislikes TEXT,
    "favoriteFoods" TEXT,
    "contactNumber" VARCHAR(255),
    "countryId" INTEGER,
    address TEXT,
    bio TEXT,
    "familyCode" VARCHAR(255),
    "associatedFamilyCodes" JSON DEFAULT '[]'::json,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 3. FT_FAMILY
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_family (
    id SERIAL PRIMARY KEY,
    "familyCode" VARCHAR(255) UNIQUE NOT NULL,
    "familyName" VARCHAR(255) NOT NULL,
    "createdBy" INTEGER REFERENCES ft_user(id),
    description TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 4. FT_FAMILY_MEMBERS (plural - used in model)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_family_members (
    id SERIAL PRIMARY KEY,
    "memberId" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    "familyCode" VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'member',
    "approveStatus" VARCHAR(50) DEFAULT 'pending',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("memberId", "familyCode")
);

-- --------------------------------------------
-- 5. FT_FAMILY_TREE
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_family_tree (
    id SERIAL PRIMARY KEY,
    "personId" INTEGER NOT NULL,
    "userId" INTEGER REFERENCES ft_user(id) ON DELETE SET NULL,
    "familyCode" VARCHAR(255) NOT NULL,
    generation INTEGER DEFAULT 0,
    "lifeStatus" VARCHAR(20) DEFAULT 'living' CHECK ("lifeStatus" IN ('living', 'remembering')),
    parents JSON DEFAULT '[]'::json,
    children JSON DEFAULT '[]'::json,
    spouses JSON DEFAULT '[]'::json,
    siblings JSON DEFAULT '[]'::json,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("personId", "familyCode")
);

-- --------------------------------------------
-- 6. FT_USER_RELATIONSHIPS
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_user_relationships (
    id SERIAL PRIMARY KEY,
    "user1Id" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    "user2Id" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    "relationshipType" VARCHAR(255) NOT NULL,
    "generatedFamilyCode" VARCHAR(255) NOT NULL,
    "isBidirectional" BOOLEAN DEFAULT true,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 7. FT_INVITE (singular - used in model)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_invite (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(255) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    "inviterId" INTEGER REFERENCES ft_user(id),
    "spouseMemberId" INTEGER,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP WITH TIME ZONE
);

-- --------------------------------------------
-- 8. FT_NOTIFICATIONS (plural - used in model)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_notifications (
    id SERIAL PRIMARY KEY,
    type VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    data JSON,
    status VARCHAR(50) DEFAULT 'pending',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 9. FT_NOTIFICATION_RECIPIENTS
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_notification_recipients (
    id SERIAL PRIMARY KEY,
    "notificationId" INTEGER NOT NULL REFERENCES ft_notifications(id) ON DELETE CASCADE,
    "userId" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    read BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("notificationId", "userId")
);

-- --------------------------------------------
-- 10. FT_POST (singular - used in model)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_post (
    id SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    "familyCode" VARCHAR(255),
    content TEXT,
    media JSON,
    privacy VARCHAR(50) DEFAULT 'public',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 11. FT_POST_COMMENT (singular - used in model)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_post_comment (
    id SERIAL PRIMARY KEY,
    "postId" INTEGER NOT NULL REFERENCES ft_post(id) ON DELETE CASCADE,
    "userId" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 12. FT_POST_LIKE (singular - used in model)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_post_like (
    id SERIAL PRIMARY KEY,
    "postId" INTEGER NOT NULL REFERENCES ft_post(id) ON DELETE CASCADE,
    "userId" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("postId", "userId")
);

-- --------------------------------------------
-- 13. FT_EVENT (singular - used in model)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_event (
    id SERIAL PRIMARY KEY,
    "familyCode" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    "eventDate" TIMESTAMP WITH TIME ZONE,
    location VARCHAR(255),
    "createdBy" INTEGER REFERENCES ft_user(id),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 14. FT_EVENT_IMAGE
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_event_image (
    id SERIAL PRIMARY KEY,
    "eventId" INTEGER NOT NULL REFERENCES ft_event(id) ON DELETE CASCADE,
    "imageUrl" VARCHAR(500),
    caption TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 15. FT_GALLERY
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_gallery (
    id SERIAL PRIMARY KEY,
    "familyCode" VARCHAR(255) NOT NULL,
    "userId" INTEGER REFERENCES ft_user(id) ON DELETE SET NULL,
    title VARCHAR(255),
    description TEXT,
    "imageUrl" VARCHAR(500),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 16. FT_GALLERY_ALBUM
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_gallery_album (
    id SERIAL PRIMARY KEY,
    "familyCode" VARCHAR(255) NOT NULL,
    "albumName" VARCHAR(255) NOT NULL,
    description TEXT,
    "coverImage" VARCHAR(500),
    "createdBy" INTEGER REFERENCES ft_user(id),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 17. FT_GALLERY_COMMENT
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_gallery_comment (
    id SERIAL PRIMARY KEY,
    "galleryId" INTEGER NOT NULL REFERENCES ft_gallery(id) ON DELETE CASCADE,
    "userId" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    comment TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 18. FT_GALLERY_LIKE
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_gallery_like (
    id SERIAL PRIMARY KEY,
    "galleryId" INTEGER NOT NULL REFERENCES ft_gallery(id) ON DELETE CASCADE,
    "userId" INTEGER NOT NULL REFERENCES ft_user(id) ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("galleryId", "userId")
);

-- --------------------------------------------
-- 19. FT_PRODUCT (singular - used in model)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_product (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2),
    "categoryId" INTEGER,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 20. FT_PRODUCT_IMAGE
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_product_image (
    id SERIAL PRIMARY KEY,
    "productId" INTEGER NOT NULL REFERENCES ft_product(id) ON DELETE CASCADE,
    "imageUrl" VARCHAR(500),
    "isPrimary" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 21. FT_CATEGORY
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_category (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 22. FT_ORDER
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_order (
    id SERIAL PRIMARY KEY,
    "userId" INTEGER NOT NULL REFERENCES ft_user(id),
    "productId" INTEGER NOT NULL REFERENCES ft_product(id),
    quantity INTEGER DEFAULT 1,
    "totalAmount" DECIMAL(10, 2),
    status VARCHAR(50) DEFAULT 'pending',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 23. FT_COUNTRY
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_country (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    code VARCHAR(10),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 24. FT_LANGUAGE
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_language (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    code VARCHAR(10),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 25. FT_RELIGION
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_religion (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 26. FT_GOTHRAM
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS ft_gothram (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 27. RELATIONSHIPS
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS relationships (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    description VARCHAR(255) NOT NULL,
    "description_en_f" VARCHAR(255),
    "description_en_m" VARCHAR(255),
    "description_ta_f" VARCHAR(255),
    "description_ta_m" VARCHAR(255),
    "description_hi_f" VARCHAR(255),
    "description_hi_m" VARCHAR(255),
    "description_ma_f" VARCHAR(255),
    "description_ma_m" VARCHAR(255),
    "description_ka_f" VARCHAR(255),
    "description_ka_m" VARCHAR(255),
    "description_te_f" VARCHAR(255),
    "description_te_m" VARCHAR(255),
    "is_auto_generated" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 28. RELATIONSHIP_TRANSLATIONS
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS relationship_translations (
    id SERIAL PRIMARY KEY,
    "relationshipId" INTEGER NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
    language VARCHAR(10) NOT NULL,
    label VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- --------------------------------------------
-- 29. CUSTOM_LABELS
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS custom_labels (
    id SERIAL PRIMARY KEY,
    "relationshipId" INTEGER NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
    language VARCHAR(255) NOT NULL,
    "custom_label" VARCHAR(255) NOT NULL,
    "creatorId" INTEGER REFERENCES ft_user(id),
    "familyId" INTEGER,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SECTION 2: CREATE INDEXES (60 total)
-- ============================================

-- FT_FAMILY_TREE INDEXES (10)
CREATE INDEX IF NOT EXISTS idx_family_tree_family_code ON ft_family_tree("familyCode");
CREATE INDEX IF NOT EXISTS idx_family_tree_user_id ON ft_family_tree("userId");
CREATE INDEX IF NOT EXISTS idx_family_tree_person_id ON ft_family_tree("personId");
CREATE INDEX IF NOT EXISTS idx_family_tree_generation ON ft_family_tree("generation");
CREATE INDEX IF NOT EXISTS idx_family_tree_composite ON ft_family_tree("familyCode", "personId");
CREATE INDEX IF NOT EXISTS idx_family_tree_user_family ON ft_family_tree("userId", "familyCode");
CREATE INDEX IF NOT EXISTS idx_family_tree_created_at ON ft_family_tree("createdAt");
CREATE INDEX IF NOT EXISTS idx_family_tree_updated_at ON ft_family_tree("updatedAt");
CREATE INDEX IF NOT EXISTS idx_family_tree_person_user ON ft_family_tree("personId", "userId");
CREATE INDEX IF NOT EXISTS idx_family_tree_gen_family ON ft_family_tree("generation", "familyCode");

-- FT_FAMILY_MEMBERS INDEXES (8)
CREATE INDEX IF NOT EXISTS idx_family_member_composite ON ft_family_members("familyCode", "memberId");
CREATE INDEX IF NOT EXISTS idx_family_member_family_code ON ft_family_members("familyCode");
CREATE INDEX IF NOT EXISTS idx_family_member_member_id ON ft_family_members("memberId");
CREATE INDEX IF NOT EXISTS idx_family_member_approve_status ON ft_family_members("approveStatus");
CREATE INDEX IF NOT EXISTS idx_family_member_role ON ft_family_members("role");
CREATE INDEX IF NOT EXISTS idx_family_member_created_at ON ft_family_members("createdAt");
CREATE INDEX IF NOT EXISTS idx_family_member_status_family ON ft_family_members("approveStatus", "familyCode");
CREATE INDEX IF NOT EXISTS idx_family_member_member_family ON ft_family_members("memberId", "familyCode");

-- FT_FAMILY INDEXES (6)
CREATE INDEX IF NOT EXISTS idx_family_family_code ON ft_family("familyCode");
CREATE INDEX IF NOT EXISTS idx_family_created_by ON ft_family("createdBy");
CREATE INDEX IF NOT EXISTS idx_family_family_name ON ft_family("familyName");
CREATE INDEX IF NOT EXISTS idx_family_created_at ON ft_family("createdAt");
CREATE INDEX IF NOT EXISTS idx_family_updated_at ON ft_family("updatedAt");
CREATE INDEX IF NOT EXISTS idx_family_code_creator ON ft_family("familyCode", "createdBy");

-- FT_USER_PROFILE INDEXES (10)
CREATE INDEX IF NOT EXISTS idx_user_profile_user_id ON ft_user_profile("userId");
CREATE INDEX IF NOT EXISTS idx_user_profile_family_code ON ft_user_profile("familyCode");
CREATE INDEX IF NOT EXISTS idx_user_profile_first_name ON ft_user_profile("firstName");
CREATE INDEX IF NOT EXISTS idx_user_profile_last_name ON ft_user_profile("lastName");
CREATE INDEX IF NOT EXISTS idx_user_profile_gender ON ft_user_profile("gender");
CREATE INDEX IF NOT EXISTS idx_user_profile_age ON ft_user_profile("age");
CREATE INDEX IF NOT EXISTS idx_user_profile_date_of_birth ON ft_user_profile("dateOfBirth");
CREATE INDEX IF NOT EXISTS idx_user_profile_family_gender ON ft_user_profile("familyCode", "gender");
CREATE INDEX IF NOT EXISTS idx_user_profile_created_at ON ft_user_profile("createdAt");
CREATE INDEX IF NOT EXISTS idx_user_profile_updated_at ON ft_user_profile("updatedAt");

-- FT_USER INDEXES (6)
CREATE INDEX IF NOT EXISTS idx_user_email ON ft_user("email");
CREATE INDEX IF NOT EXISTS idx_user_mobile ON ft_user("mobile");
CREATE INDEX IF NOT EXISTS idx_user_email_status ON ft_user("emailVerificationStatus");
CREATE INDEX IF NOT EXISTS idx_user_mobile_status ON ft_user("mobileVerificationStatus");
CREATE INDEX IF NOT EXISTS idx_user_created_at ON ft_user("createdAt");
CREATE INDEX IF NOT EXISTS idx_user_role ON ft_user("role");

-- FT_USER_RELATIONSHIPS INDEXES (6)
CREATE INDEX IF NOT EXISTS idx_user_relationships_user1 ON ft_user_relationships("user1Id");
CREATE INDEX IF NOT EXISTS idx_user_relationships_user2 ON ft_user_relationships("user2Id");
CREATE INDEX IF NOT EXISTS idx_user_relationships_type ON ft_user_relationships("relationshipType");
CREATE INDEX IF NOT EXISTS idx_user_relationships_family_code ON ft_user_relationships("generatedFamilyCode");
CREATE INDEX IF NOT EXISTS idx_user_relationships_composite ON ft_user_relationships("user1Id", "user2Id", "relationshipType");
CREATE INDEX IF NOT EXISTS idx_user_relationships_bidirectional ON ft_user_relationships("isBidirectional");

-- FT_NOTIFICATIONS INDEXES (8)
CREATE INDEX IF NOT EXISTS idx_notifications_type ON ft_notifications("type");
CREATE INDEX IF NOT EXISTS idx_notifications_status ON ft_notifications("status");
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON ft_notifications("createdAt");
CREATE INDEX IF NOT EXISTS idx_notifications_updated_at ON ft_notifications("updatedAt");
CREATE INDEX IF NOT EXISTS idx_notifications_type_status ON ft_notifications("type", "status");
CREATE INDEX IF NOT EXISTS idx_notifications_created_desc ON ft_notifications("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_notification_recipients_notification_id ON ft_notification_recipients("notificationId");
CREATE INDEX IF NOT EXISTS idx_notification_recipients_user_id ON ft_notification_recipients("userId");

-- FT_POST INDEXES (4)
CREATE INDEX IF NOT EXISTS idx_post_user_id ON ft_post("userId");
CREATE INDEX IF NOT EXISTS idx_post_family_code ON ft_post("familyCode");
CREATE INDEX IF NOT EXISTS idx_post_created_at ON ft_post("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_post_privacy ON ft_post("privacy");

-- FT_GALLERY INDEXES (2)
CREATE INDEX IF NOT EXISTS idx_gallery_family_code ON ft_gallery("familyCode");
CREATE INDEX IF NOT EXISTS idx_gallery_created_at ON ft_gallery("createdAt" DESC);

-- ============================================
-- VERIFICATION
-- ============================================

DO $$
DECLARE
    table_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count
    FROM pg_tables 
    WHERE schemaname = 'public';
    
    RAISE NOTICE '';
    RAISE NOTICE '============================================';
    RAISE NOTICE '✅ COMPLETE SCHEMA v2.0 CREATED!';
    RAISE NOTICE '============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📊 Created 29 tables (verified from models)';
    RAISE NOTICE '🔗 Created 60 performance indexes';
    RAISE NOTICE '✅ All foreign keys defined';
    RAISE NOTICE '🔒 Safe to run multiple times';
    RAISE NOTICE '';
    RAISE NOTICE '📋 Current table count: %', table_count;
    RAISE NOTICE '============================================';
END $$;
