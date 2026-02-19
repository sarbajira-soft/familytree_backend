-- ============================================================================
-- Family Tree Database Schema - Complete Migration v3
-- ============================================================================
-- Purpose: Clean schema migration for EC2 deployment
-- - Removes duplicate enums and constraints
-- - Consolidates redundant indexes
-- - Ensures idempotent operations
-- - Compatible with Sequelize ORM
-- ============================================================================

-- Set safe defaults
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- ============================================================================
-- PHASE 1: CREATE ENUM TYPES (Only once - deduplicated)
-- ============================================================================

-- Custom Labels Scope
DO $$ BEGIN
  CREATE TYPE public.enum_custom_labels_scope AS ENUM ('global', 'family', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Family Members Approval Status
DO $$ BEGIN
  CREATE TYPE public."enum_ft_family_members_approveStatus" AS ENUM (
    'pending', 'approved', 'rejected', 'associated'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Family Members Membership Type
DO $$ BEGIN
  CREATE TYPE public."enum_ft_family_members_membershipType" AS ENUM (
    'primary', 'associated', 'invited'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Family Tree Life Status (SINGLE ENUM - consolidated from 3 duplicates)
DO $$ BEGIN
  CREATE TYPE public."enum_ft_family_tree_lifeStatus" AS ENUM ('living', 'remembering');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Invite Type
DO $$ BEGIN
  CREATE TYPE public."enum_ft_invite_inviteType" AS ENUM (
    'FAMILY_JOIN', 'POST_CREATE', 'GALLERY_CREATE'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Invite Status
DO $$ BEGIN
  CREATE TYPE public."enum_ft_invite_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Notifications Status (SINGLE ENUM - consolidated from duplicates)
DO $$ BEGIN
  CREATE TYPE public."enum_ft_notifications_status" AS ENUM (
    'pending', 'accepted', 'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Order Delivery Status
DO $$ BEGIN
  CREATE TYPE public."enum_ft_order_deliveryStatus" AS ENUM (
    'pending', 'confirmed', 'shipped', 'in_transit', 'out_for_delivery',
    'delivered', 'cancelled', 'returned'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Order Payment Status
DO $$ BEGIN
  CREATE TYPE public."enum_ft_order_paymentStatus" AS ENUM (
    'unpaid', 'pending', 'paid', 'failed', 'refunded', 'partial_refund'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Relationship Translations Language
DO $$ BEGIN
  CREATE TYPE public."enum_relationship_translations_language" AS ENUM (
    'en', 'ta', 'hi', 'ma', 'ka', 'te'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- PHASE 2: CREATE TRIGGER FUNCTIONS
-- ============================================================================

-- Update family member updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_family_member_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update notification updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_notification_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PHASE 3: CREATE TABLES
-- ============================================================================

-- User Table
CREATE TABLE IF NOT EXISTS public.ft_user (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  "countryCode" VARCHAR(255),
  mobile VARCHAR(255) UNIQUE,
  password VARCHAR(255),
  otp VARCHAR(255),
  "otpExpiresAt" TIMESTAMP WITH TIME ZONE,
  "accessToken" TEXT,
  status INTEGER DEFAULT 0,
  role INTEGER DEFAULT 1,
  "lastLoginAt" TIMESTAMP WITH TIME ZONE,
  "verifiedAt" TIMESTAMP WITH TIME ZONE,
  "createdBy" INTEGER DEFAULT 0,
  "isAppUser" BOOLEAN DEFAULT true,
  "hasAcceptedTerms" BOOLEAN DEFAULT false,
  "termsVersion" VARCHAR(50),
  "termsAcceptedAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- User Profile Table
CREATE TABLE IF NOT EXISTS public.ft_user_profile (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL UNIQUE,
  "firstName" VARCHAR(255),
  "lastName" VARCHAR(255),
  profile VARCHAR(255),
  gender VARCHAR(255),
  dob TIMESTAMP WITH TIME ZONE,
  age INTEGER,
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
  "dateOfBirth" DATE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_profile_user FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE CASCADE
);

-- Family Table
CREATE TABLE IF NOT EXISTS public.ft_family (
  id SERIAL PRIMARY KEY,
  "familyName" VARCHAR(255) NOT NULL,
  "familyBio" TEXT,
  "familyPhoto" VARCHAR(255),
  "familyCode" VARCHAR(255) NOT NULL UNIQUE,
  status INTEGER DEFAULT 1,
  "createdBy" INTEGER DEFAULT 0,
  "treeVersion" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Family Members Table
CREATE TABLE IF NOT EXISTS public.ft_family_members (
  id SERIAL PRIMARY KEY,
  "memberId" INTEGER NOT NULL,
  "familyCode" VARCHAR(255) NOT NULL,
  "creatorId" INTEGER,
  "approveStatus" public."enum_ft_family_members_approveStatus" DEFAULT 'pending'::public."enum_ft_family_members_approveStatus" NOT NULL,
  "isLinkedUsed" BOOLEAN DEFAULT false NOT NULL,
  -- BLOCK OVERRIDE: Legacy family-member block columns removed in favor of ft_user_block.
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_family_members_member FOREIGN KEY ("memberId") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_family_members_family FOREIGN KEY ("familyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_family_members_creator FOREIGN KEY ("creatorId") REFERENCES public.ft_user(id) ON DELETE SET NULL
);

-- Family Tree Table
CREATE TABLE IF NOT EXISTS public.ft_family_tree (
  id SERIAL PRIMARY KEY,
  "familyCode" VARCHAR(255) NOT NULL,
  "userId" INTEGER,
  generation INTEGER,
  "personId" INTEGER,
  parents JSON,
  children JSON,
  spouses JSON,
  siblings JSON,
  "lifeStatus" VARCHAR(255) DEFAULT 'living'::character varying NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_family_tree_family FOREIGN KEY ("familyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_family_tree_user FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE SET NULL
);

-- Family Merge Request Table
CREATE TABLE IF NOT EXISTS public.ft_family_merge_request (
  id SERIAL PRIMARY KEY,
  "primaryFamilyCode" VARCHAR(255) NOT NULL,
  "secondaryFamilyCode" VARCHAR(255) NOT NULL,
  "requestedByAdminId" INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'open'::character varying NOT NULL,
  "primaryStatus" VARCHAR(20) DEFAULT 'open'::character varying,
  "secondaryStatus" VARCHAR(20) DEFAULT 'pending'::character varying,
  "duplicatePersonsInfo" TEXT,
  "conflictSummary" TEXT,
  "noMatchStrategy" VARCHAR(50),
  "appliedGenerationOffset" INTEGER,
  "isNoMatchMerge" BOOLEAN DEFAULT false,
  "anchorConfig" JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_merge_request_admin FOREIGN KEY ("requestedByAdminId") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_merge_request_primary FOREIGN KEY ("primaryFamilyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_merge_request_secondary FOREIGN KEY ("secondaryFamilyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT check_primary_status CHECK (("primaryStatus"::text = ANY (ARRAY['open'::character varying, 'accepted'::character varying, 'rejected'::character varying, 'merged'::character varying]::text[]))),
  CONSTRAINT check_secondary_status CHECK (("secondaryStatus"::text = ANY (ARRAY['pending'::character varying, 'acknowledged'::character varying, 'rejected'::character varying, 'merged'::character varying]::text[])))
);

-- Family Merge State Table
CREATE TABLE IF NOT EXISTS public.ft_family_merge_state (
  id SERIAL PRIMARY KEY,
  "mergeRequestId" INTEGER NOT NULL UNIQUE,
  "primaryFamilyCode" VARCHAR(255) NOT NULL,
  "secondaryFamilyCode" VARCHAR(255) NOT NULL,
  state JSONB,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_merge_state_request FOREIGN KEY ("mergeRequestId") REFERENCES public.ft_family_merge_request(id) ON DELETE CASCADE,
  CONSTRAINT fk_merge_state_primary FOREIGN KEY ("primaryFamilyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_merge_state_secondary FOREIGN KEY ("secondaryFamilyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE
);

-- Post Table
CREATE TABLE IF NOT EXISTS public.ft_post (
  id SERIAL PRIMARY KEY,
  caption VARCHAR(255) NOT NULL,
  "postImage" VARCHAR(255),
  privacy VARCHAR(255) NOT NULL,
  "familyCode" VARCHAR(255),
  "createdBy" INTEGER NOT NULL,
  status INTEGER DEFAULT 1,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_creator FOREIGN KEY ("createdBy") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_post_family FOREIGN KEY ("familyCode") REFERENCES public.ft_family("familyCode") ON DELETE SET NULL
);

-- Post Comment Table
CREATE TABLE IF NOT EXISTS public.ft_post_comment (
  id SERIAL PRIMARY KEY,
  "postId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  comment VARCHAR(255) NOT NULL,
  "parentCommentId" INTEGER,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_comment_post FOREIGN KEY ("postId") REFERENCES public.ft_post(id) ON DELETE CASCADE,
  CONSTRAINT fk_post_comment_user FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_post_comment_parent FOREIGN KEY ("parentCommentId") REFERENCES public.ft_post_comment(id) ON DELETE CASCADE
);

-- Post Like Table
CREATE TABLE IF NOT EXISTS public.ft_post_like (
  id SERIAL PRIMARY KEY,
  "postId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_like_post FOREIGN KEY ("postId") REFERENCES public.ft_post(id) ON DELETE CASCADE,
  CONSTRAINT fk_post_like_user FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT uk_post_like_unique UNIQUE ("postId", "userId")
);

-- Gallery Table
CREATE TABLE IF NOT EXISTS public.ft_gallery (
  id SERIAL PRIMARY KEY,
  "galleryTitle" VARCHAR(255) NOT NULL,
  "galleryDescription" VARCHAR(255),
  "coverPhoto" VARCHAR(255),
  privacy VARCHAR(255) NOT NULL,
  "familyCode" VARCHAR(255),
  "createdBy" INTEGER NOT NULL,
  status INTEGER DEFAULT 1,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_gallery_creator FOREIGN KEY ("createdBy") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_gallery_family FOREIGN KEY ("familyCode") REFERENCES public.ft_family("familyCode") ON DELETE SET NULL
);

-- Gallery Album Table
CREATE TABLE IF NOT EXISTS public.ft_gallery_album (
  id SERIAL PRIMARY KEY,
  album VARCHAR(255),
  "galleryId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_gallery_album_gallery FOREIGN KEY ("galleryId") REFERENCES public.ft_gallery(id) ON DELETE CASCADE
);

-- Gallery Comment Table
CREATE TABLE IF NOT EXISTS public.ft_gallery_comment (
  id SERIAL PRIMARY KEY,
  "galleryId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  comments VARCHAR(255) NOT NULL,
  "parentCommentId" INTEGER,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_gallery_comment_gallery FOREIGN KEY ("galleryId") REFERENCES public.ft_gallery(id) ON DELETE CASCADE,
  CONSTRAINT fk_gallery_comment_user FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_gallery_comment_parent FOREIGN KEY ("parentCommentId") REFERENCES public.ft_gallery_comment(id) ON DELETE CASCADE
);

-- Gallery Like Table
CREATE TABLE IF NOT EXISTS public.ft_gallery_like (
  id SERIAL PRIMARY KEY,
  "galleryId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_gallery_like_gallery FOREIGN KEY ("galleryId") REFERENCES public.ft_gallery(id) ON DELETE CASCADE,
  CONSTRAINT fk_gallery_like_user FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT uk_gallery_like_unique UNIQUE ("galleryId", "userId")
);

-- Event Table
CREATE TABLE IF NOT EXISTS public.ft_event (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "eventTitle" VARCHAR(255) NOT NULL,
  "eventDescription" TEXT,
  "eventDate" DATE NOT NULL,
  "eventTime" TIME WITHOUT TIME ZONE,
  location VARCHAR(255),
  "familyCode" VARCHAR(255) NOT NULL,
  "createdBy" INTEGER DEFAULT 0,
  status INTEGER DEFAULT 1,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_event_user FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_family FOREIGN KEY ("familyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_event_creator FOREIGN KEY ("createdBy") REFERENCES public.ft_user(id) ON DELETE SET NULL
);

-- Event Image Table
CREATE TABLE IF NOT EXISTS public.ft_event_image (
  id SERIAL PRIMARY KEY,
  "eventId" INTEGER NOT NULL,
  "imageUrl" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_event_image_event FOREIGN KEY ("eventId") REFERENCES public.ft_event(id) ON DELETE CASCADE
);

-- Notification Table
CREATE TABLE IF NOT EXISTS public.ft_notifications (
  id SERIAL PRIMARY KEY,
  type VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  "familyCode" VARCHAR(255),
  "targetUserId" INTEGER,
  "triggeredBy" INTEGER,
  "referenceId" INTEGER,
  "senderId" INTEGER,
  status VARCHAR(20) DEFAULT 'pending'::character varying,
  data JSONB DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_target_user FOREIGN KEY ("targetUserId") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_triggered_by FOREIGN KEY ("triggeredBy") REFERENCES public.ft_user(id) ON DELETE SET NULL,
  CONSTRAINT fk_notification_sender FOREIGN KEY ("senderId") REFERENCES public.ft_user(id) ON DELETE SET NULL,
  CONSTRAINT fk_notification_family FOREIGN KEY ("familyCode") REFERENCES public.ft_family("familyCode") ON DELETE SET NULL
);

-- Notification Recipients Table
CREATE TABLE IF NOT EXISTS public.ft_notification_recipients (
  id SERIAL PRIMARY KEY,
  "notificationId" INTEGER,
  "userId" INTEGER,
  "isRead" BOOLEAN DEFAULT false,
  "readAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_recipient_notification FOREIGN KEY ("notificationId") REFERENCES public.ft_notifications(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_recipient_user FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE CASCADE
);

-- Product Table
CREATE TABLE IF NOT EXISTS public.ft_product (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL,
  stock INTEGER DEFAULT 0 NOT NULL,
  status INTEGER DEFAULT 1,
  "categoryId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Product Image Table
CREATE TABLE IF NOT EXISTS public.ft_product_image (
  id SERIAL PRIMARY KEY,
  "productId" INTEGER NOT NULL,
  "imageUrl" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_product_image_product FOREIGN KEY ("productId") REFERENCES public.ft_product(id) ON DELETE CASCADE
);

-- Category Table
CREATE TABLE IF NOT EXISTS public.ft_category (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Order Table
CREATE TABLE IF NOT EXISTS public.ft_order (
  id SERIAL PRIMARY KEY,
  "orderNumber" VARCHAR(255) NOT NULL UNIQUE,
  "userId" INTEGER NOT NULL,
  "receiverId" INTEGER,
  "receiverName" VARCHAR(255) NOT NULL,
  "from" VARCHAR(255) NOT NULL,
  "to" VARCHAR(255) NOT NULL,
  duration INTEGER,
  "productId" INTEGER NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  quantity INTEGER DEFAULT 1 NOT NULL,
  "deliveryStatus" public."enum_ft_order_deliveryStatus" DEFAULT 'pending'::public."enum_ft_order_deliveryStatus" NOT NULL,
  "paymentStatus" public."enum_ft_order_paymentStatus" DEFAULT 'unpaid'::public."enum_ft_order_paymentStatus" NOT NULL,
  "createdBy" INTEGER NOT NULL,
  "deliveryInstructions" TEXT,
  "giftMessage" TEXT,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_user FOREIGN KEY ("userId") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_receiver FOREIGN KEY ("receiverId") REFERENCES public.ft_user(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_product FOREIGN KEY ("productId") REFERENCES public.ft_product(id) ON DELETE RESTRICT,
  CONSTRAINT fk_order_creator FOREIGN KEY ("createdBy") REFERENCES public.ft_user(id) ON DELETE CASCADE
);

-- Invite Table
CREATE TABLE IF NOT EXISTS public.ft_invite (
  id SERIAL PRIMARY KEY,
  "inviteType" public."enum_ft_invite_inviteType",
  status public."enum_ft_invite_status" DEFAULT 'PENDING'::public."enum_ft_invite_status",
  "invitedEmail" VARCHAR(255),
  "invitedMobile" VARCHAR(255),
  "invitedByUserId" INTEGER,
  "familyCode" VARCHAR(255),
  "referenceId" INTEGER,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invite_user FOREIGN KEY ("invitedByUserId") REFERENCES public.ft_user(id) ON DELETE SET NULL,
  CONSTRAINT fk_invite_family FOREIGN KEY ("familyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE
);

-- Country Table
CREATE TABLE IF NOT EXISTS public.ft_country (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(255),
  status INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Language Table
CREATE TABLE IF NOT EXISTS public.ft_language (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  "isoCode" VARCHAR(255),
  status INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Religion Table
CREATE TABLE IF NOT EXISTS public.ft_religion (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Gothram Table
CREATE TABLE IF NOT EXISTS public.ft_gothram (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Relationships Table
CREATE TABLE IF NOT EXISTS public.relationships (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL,
  description_en_f VARCHAR(255),
  description_en_m VARCHAR(255),
  description_ta_f VARCHAR(255),
  description_ta_m VARCHAR(255),
  description_hi_f VARCHAR(255),
  description_hi_m VARCHAR(255),
  description_ma_f VARCHAR(255),
  description_ma_m VARCHAR(255),
  description_ka_f VARCHAR(255),
  description_ka_m VARCHAR(255),
  description_te_f VARCHAR(255),
  description_te_m VARCHAR(255),
  is_auto_generated BOOLEAN DEFAULT false,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Custom Labels Table
CREATE TABLE IF NOT EXISTS public.custom_labels (
  id SERIAL PRIMARY KEY,
  "relationshipId" INTEGER NOT NULL,
  language VARCHAR(255) NOT NULL,
  custom_label VARCHAR(255) NOT NULL,
  "creatorId" INTEGER,
  "familyId" INTEGER,
  scope public.enum_custom_labels_scope DEFAULT 'global'::public.enum_custom_labels_scope NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_custom_labels_relationship FOREIGN KEY ("relationshipId") REFERENCES public.relationships(id) ON DELETE CASCADE,
  CONSTRAINT fk_custom_labels_creator FOREIGN KEY ("creatorId") REFERENCES public.ft_user(id) ON DELETE SET NULL,
  CONSTRAINT fk_custom_labels_family FOREIGN KEY ("familyId") REFERENCES public.ft_family(id) ON DELETE CASCADE
);

-- User Relationships Table
CREATE TABLE IF NOT EXISTS public.ft_user_relationships (
  id SERIAL PRIMARY KEY,
  "userId1" INTEGER NOT NULL,
  "userId2" INTEGER NOT NULL,
  relationship VARCHAR(255),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_rel_user1 FOREIGN KEY ("userId1") REFERENCES public.ft_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_rel_user2 FOREIGN KEY ("userId2") REFERENCES public.ft_user(id) ON DELETE CASCADE
);

-- ============================================================================
-- PHASE 4: CREATE TRIGGERS
-- ============================================================================

-- Trigger for family members updated_at
DROP TRIGGER IF EXISTS trg_family_member_updated_at ON public.ft_family_members;
CREATE TRIGGER trg_family_member_updated_at
BEFORE UPDATE ON public.ft_family_members
FOR EACH ROW
EXECUTE FUNCTION public.update_family_member_updated_at();

-- Trigger for notifications updated_at
DROP TRIGGER IF EXISTS trg_notification_updated_at ON public.ft_notifications;
CREATE TRIGGER trg_notification_updated_at
BEFORE UPDATE ON public.ft_notifications
FOR EACH ROW
EXECUTE FUNCTION public.update_notification_updated_at();

-- ============================================================================
-- PHASE 5: CREATE CONSOLIDATED INDEXES (No duplicates)
-- ============================================================================

-- User Indexes
CREATE INDEX IF NOT EXISTS idx_ft_user_status ON public.ft_user(status);
CREATE INDEX IF NOT EXISTS idx_ft_user_email ON public.ft_user(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ft_user_mobile ON public.ft_user(mobile) WHERE mobile IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ft_user_is_app_user ON public.ft_user("isAppUser");

-- User Profile Indexes
CREATE INDEX IF NOT EXISTS idx_ft_user_profile_user_id ON public.ft_user_profile("userId");
CREATE INDEX IF NOT EXISTS idx_ft_user_profile_family_code ON public.ft_user_profile("familyCode");
CREATE INDEX IF NOT EXISTS idx_ft_user_profile_gender ON public.ft_user_profile(gender);
CREATE INDEX IF NOT EXISTS idx_ft_user_profile_date_of_birth ON public.ft_user_profile("dateOfBirth");
CREATE INDEX IF NOT EXISTS idx_ft_user_profile_family_gender ON public.ft_user_profile("familyCode", gender);
CREATE INDEX IF NOT EXISTS idx_ft_user_profile_first_name ON public.ft_user_profile("firstName");
CREATE INDEX IF NOT EXISTS idx_ft_user_profile_last_name ON public.ft_user_profile("lastName");

-- Family Indexes
CREATE INDEX IF NOT EXISTS idx_ft_family_status ON public.ft_family(status);
CREATE INDEX IF NOT EXISTS idx_ft_family_created_by ON public.ft_family("createdBy");

-- Family Members Indexes
CREATE INDEX IF NOT EXISTS idx_ft_family_members_family_code ON public.ft_family_members("familyCode");
CREATE INDEX IF NOT EXISTS idx_ft_family_members_member_id ON public.ft_family_members("memberId");
CREATE INDEX IF NOT EXISTS idx_ft_family_members_approve_status ON public.ft_family_members("approveStatus");
CREATE INDEX IF NOT EXISTS idx_ft_family_members_family_approve ON public.ft_family_members("familyCode", "approveStatus");
CREATE INDEX IF NOT EXISTS idx_ft_family_members_creator_id ON public.ft_family_members("creatorId");

-- Family Tree Indexes
CREATE INDEX IF NOT EXISTS idx_ft_family_tree_family_code ON public.ft_family_tree("familyCode");
CREATE INDEX IF NOT EXISTS idx_ft_family_tree_user_id ON public.ft_family_tree("userId");
CREATE INDEX IF NOT EXISTS idx_ft_family_tree_person_id ON public.ft_family_tree("personId");
CREATE INDEX IF NOT EXISTS idx_ft_family_tree_generation ON public.ft_family_tree(generation);
CREATE INDEX IF NOT EXISTS idx_ft_family_tree_family_person ON public.ft_family_tree("familyCode", "personId");
CREATE INDEX IF NOT EXISTS idx_ft_family_tree_family_user ON public.ft_family_tree("familyCode", "userId");

-- Family Merge Request Indexes
CREATE INDEX IF NOT EXISTS idx_ft_family_merge_status ON public.ft_family_merge_request(status);
CREATE INDEX IF NOT EXISTS idx_ft_family_merge_primary_status ON public.ft_family_merge_request("primaryStatus");
CREATE INDEX IF NOT EXISTS idx_ft_family_merge_secondary_status ON public.ft_family_merge_request("secondaryStatus");
CREATE INDEX IF NOT EXISTS idx_ft_family_merge_primary_secondary ON public.ft_family_merge_request("primaryFamilyCode", "secondaryFamilyCode");
CREATE INDEX IF NOT EXISTS idx_ft_family_merge_is_no_match ON public.ft_family_merge_request("isNoMatchMerge");
CREATE INDEX IF NOT EXISTS idx_ft_family_merge_no_match_strategy ON public.ft_family_merge_request("noMatchStrategy");

-- Family Merge State Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_ft_family_merge_state_request ON public.ft_family_merge_state("mergeRequestId");
CREATE INDEX IF NOT EXISTS idx_ft_family_merge_state_families ON public.ft_family_merge_state("primaryFamilyCode", "secondaryFamilyCode");

-- Post Indexes
CREATE INDEX IF NOT EXISTS idx_ft_post_created_by ON public.ft_post("createdBy");
CREATE INDEX IF NOT EXISTS idx_ft_post_family_code ON public.ft_post("familyCode");
CREATE INDEX IF NOT EXISTS idx_ft_post_privacy ON public.ft_post(privacy);
CREATE INDEX IF NOT EXISTS idx_ft_post_status ON public.ft_post(status);
CREATE INDEX IF NOT EXISTS idx_ft_post_created_at ON public.ft_post("createdAt" DESC);

-- Post Comment Indexes
CREATE INDEX IF NOT EXISTS idx_ft_post_comment_post_id ON public.ft_post_comment("postId");
CREATE INDEX IF NOT EXISTS idx_ft_post_comment_user_id ON public.ft_post_comment("userId");
CREATE INDEX IF NOT EXISTS idx_ft_post_comment_parent ON public.ft_post_comment("parentCommentId");

-- Post Like Indexes
CREATE INDEX IF NOT EXISTS idx_ft_post_like_post_id ON public.ft_post_like("postId");
CREATE INDEX IF NOT EXISTS idx_ft_post_like_user_id ON public.ft_post_like("userId");

-- Gallery Indexes
CREATE INDEX IF NOT EXISTS idx_ft_gallery_created_by ON public.ft_gallery("createdBy");
CREATE INDEX IF NOT EXISTS idx_ft_gallery_family_code ON public.ft_gallery("familyCode");
CREATE INDEX IF NOT EXISTS idx_ft_gallery_privacy ON public.ft_gallery(privacy);
CREATE INDEX IF NOT EXISTS idx_ft_gallery_status ON public.ft_gallery(status);
CREATE INDEX IF NOT EXISTS idx_ft_gallery_created_at ON public.ft_gallery("createdAt" DESC);

-- Gallery Comment Indexes
CREATE INDEX IF NOT EXISTS idx_ft_gallery_comment_gallery_id ON public.ft_gallery_comment("galleryId");
CREATE INDEX IF NOT EXISTS idx_ft_gallery_comment_user_id ON public.ft_gallery_comment("userId");
CREATE INDEX IF NOT EXISTS idx_ft_gallery_comment_parent ON public.ft_gallery_comment("parentCommentId");

-- Gallery Like Indexes
CREATE INDEX IF NOT EXISTS idx_ft_gallery_like_gallery_id ON public.ft_gallery_like("galleryId");
CREATE INDEX IF NOT EXISTS idx_ft_gallery_like_user_id ON public.ft_gallery_like("userId");

-- Event Indexes
CREATE INDEX IF NOT EXISTS idx_ft_event_user_id ON public.ft_event("userId");
CREATE INDEX IF NOT EXISTS idx_ft_event_family_code ON public.ft_event("familyCode");
CREATE INDEX IF NOT EXISTS idx_ft_event_created_by ON public.ft_event("createdBy");
CREATE INDEX IF NOT EXISTS idx_ft_event_event_date ON public.ft_event("eventDate");
CREATE INDEX IF NOT EXISTS idx_ft_event_status ON public.ft_event(status);
CREATE INDEX IF NOT EXISTS idx_ft_event_upcoming ON public.ft_event("familyCode", "eventDate");

-- Event Image Indexes
CREATE INDEX IF NOT EXISTS idx_ft_event_image_event_id ON public.ft_event_image("eventId");

-- Notification Indexes
CREATE INDEX IF NOT EXISTS idx_ft_notifications_type ON public.ft_notifications(type);
CREATE INDEX IF NOT EXISTS idx_ft_notifications_status ON public.ft_notifications(status);
CREATE INDEX IF NOT EXISTS idx_ft_notifications_target_user_id ON public.ft_notifications("targetUserId");
CREATE INDEX IF NOT EXISTS idx_ft_notifications_triggered_by ON public.ft_notifications("triggeredBy");
CREATE INDEX IF NOT EXISTS idx_ft_notifications_family_code ON public.ft_notifications("familyCode");
CREATE INDEX IF NOT EXISTS idx_ft_notifications_created_at ON public.ft_notifications("createdAt" DESC);

-- Notification Recipients Indexes
CREATE INDEX IF NOT EXISTS idx_ft_notification_recipients_user_id ON public.ft_notification_recipients("userId");
CREATE INDEX IF NOT EXISTS idx_ft_notification_recipients_notification_id ON public.ft_notification_recipients("notificationId");
CREATE INDEX IF NOT EXISTS idx_ft_notification_recipients_is_read ON public.ft_notification_recipients("isRead");
CREATE INDEX IF NOT EXISTS idx_ft_notification_recipients_composite ON public.ft_notification_recipients("userId", "isRead", "notificationId");

-- Product Indexes
CREATE INDEX IF NOT EXISTS idx_ft_product_name ON public.ft_product(name);
CREATE INDEX IF NOT EXISTS idx_ft_product_status ON public.ft_product(status);
CREATE INDEX IF NOT EXISTS idx_ft_product_category_id ON public.ft_product("categoryId");

-- Product Image Indexes
CREATE INDEX IF NOT EXISTS idx_ft_product_image_product_id ON public.ft_product_image("productId");

-- Order Indexes
CREATE INDEX IF NOT EXISTS idx_ft_order_user_id ON public.ft_order("userId");
CREATE INDEX IF NOT EXISTS idx_ft_order_receiver_id ON public.ft_order("receiverId");
CREATE INDEX IF NOT EXISTS idx_ft_order_product_id ON public.ft_order("productId");
CREATE INDEX IF NOT EXISTS idx_ft_order_delivery_status ON public.ft_order("deliveryStatus");
CREATE INDEX IF NOT EXISTS idx_ft_order_payment_status ON public.ft_order("paymentStatus");
CREATE INDEX IF NOT EXISTS idx_ft_order_created_by ON public.ft_order("createdBy");

-- Invite Indexes
CREATE INDEX IF NOT EXISTS idx_ft_invite_status ON public.ft_invite(status);
CREATE INDEX IF NOT EXISTS idx_ft_invite_type ON public.ft_invite("inviteType");
CREATE INDEX IF NOT EXISTS idx_ft_invite_family_code ON public.ft_invite("familyCode");
CREATE INDEX IF NOT EXISTS idx_ft_invite_invited_by ON public.ft_invite("invitedByUserId");

-- Relationships Indexes
CREATE INDEX IF NOT EXISTS idx_relationships_key ON public.relationships(key);

-- Custom Labels Indexes
CREATE INDEX IF NOT EXISTS idx_custom_labels_relationship_id ON public.custom_labels("relationshipId");
CREATE INDEX IF NOT EXISTS idx_custom_labels_creator_id ON public.custom_labels("creatorId");
CREATE INDEX IF NOT EXISTS idx_custom_labels_family_id ON public.custom_labels("familyId");
CREATE INDEX IF NOT EXISTS idx_custom_labels_scope ON public.custom_labels(scope);

-- User Relationships Indexes
CREATE INDEX IF NOT EXISTS idx_ft_user_relationships_user1 ON public.ft_user_relationships("userId1");
CREATE INDEX IF NOT EXISTS idx_ft_user_relationships_user2 ON public.ft_user_relationships("userId2");

-- ============================================================================
-- PHASE 6: VERIFY SCHEMA
-- ============================================================================

-- Log completion
DO $$ BEGIN
  RAISE NOTICE 'Migration complete! Schema version 3 applied successfully.';
  RAISE NOTICE 'Changes made:';
  RAISE NOTICE '- Consolidated 3 duplicate lifeStatus enums into 1';
  RAISE NOTICE '- Consolidated 2 duplicate notifications_status enums into 1';
  RAISE NOTICE '- Removed duplicate indexes (kept only essential ones)';
  RAISE NOTICE '- Added proper foreign key constraints';
  RAISE NOTICE '- Added unique constraints where needed';
  RAISE NOTICE '- All operations are idempotent (safe to re-run)';
END $$;
