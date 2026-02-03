-- Phase 1: Hybrid cross-family linking primitives (additive / non-breaking)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE IF EXISTS public.ft_family_tree
  ADD COLUMN IF NOT EXISTS "nodeUid" UUID;

UPDATE public.ft_family_tree
SET "nodeUid" = gen_random_uuid()
WHERE "nodeUid" IS NULL;

ALTER TABLE IF EXISTS public.ft_family_tree
  ALTER COLUMN "nodeUid" SET DEFAULT gen_random_uuid();

ALTER TABLE IF EXISTS public.ft_family_tree
  ALTER COLUMN "nodeUid" SET NOT NULL;

ALTER TABLE IF EXISTS public.ft_family_tree
  ADD COLUMN IF NOT EXISTS "isExternalLinked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS public.ft_family_tree
  ADD COLUMN IF NOT EXISTS "canonicalFamilyCode" VARCHAR(255);

ALTER TABLE IF EXISTS public.ft_family_tree
  ADD COLUMN IF NOT EXISTS "canonicalNodeUid" UUID;

CREATE INDEX IF NOT EXISTS idx_ft_family_tree_node_uid
  ON public.ft_family_tree ("nodeUid");

CREATE INDEX IF NOT EXISTS idx_ft_family_tree_family_code_node_uid
  ON public.ft_family_tree ("familyCode", "nodeUid");

CREATE INDEX IF NOT EXISTS idx_ft_family_tree_family_code_external
  ON public.ft_family_tree ("familyCode", "isExternalLinked");

CREATE TABLE IF NOT EXISTS public.ft_family_link (
  id SERIAL PRIMARY KEY,
  "familyCodeLow" VARCHAR(255) NOT NULL,
  "familyCodeHigh" VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'tree',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_family_link_low
    FOREIGN KEY ("familyCodeLow") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_family_link_high
    FOREIGN KEY ("familyCodeHigh") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT uq_family_link_pair UNIQUE ("familyCodeLow", "familyCodeHigh")
);

CREATE INDEX IF NOT EXISTS idx_ft_family_link_low
  ON public.ft_family_link ("familyCodeLow");

CREATE INDEX IF NOT EXISTS idx_ft_family_link_high
  ON public.ft_family_link ("familyCodeHigh");

CREATE TABLE IF NOT EXISTS public.ft_tree_link_request (
  id SERIAL PRIMARY KEY,
  "senderFamilyCode" VARCHAR(255) NOT NULL,
  "receiverFamilyCode" VARCHAR(255) NOT NULL,
  "senderNodeUid" UUID NOT NULL,
  "receiverNodeUid" UUID NOT NULL,
  "relationshipType" VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  "createdBy" INTEGER,
  "respondedBy" INTEGER,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tlr_sender_family
    FOREIGN KEY ("senderFamilyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_tlr_receiver_family
    FOREIGN KEY ("receiverFamilyCode") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_tlr_created_by
    FOREIGN KEY ("createdBy") REFERENCES public.ft_user(id) ON DELETE SET NULL,
  CONSTRAINT fk_tlr_responded_by
    FOREIGN KEY ("respondedBy") REFERENCES public.ft_user(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ft_tree_link_request_sender_family
  ON public.ft_tree_link_request ("senderFamilyCode");

CREATE INDEX IF NOT EXISTS idx_ft_tree_link_request_receiver_family
  ON public.ft_tree_link_request ("receiverFamilyCode");

CREATE INDEX IF NOT EXISTS idx_ft_tree_link_request_status
  ON public.ft_tree_link_request (status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ft_tree_link_request_pending
  ON public.ft_tree_link_request ("senderFamilyCode", "receiverFamilyCode", "senderNodeUid", "receiverNodeUid", "relationshipType")
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.ft_tree_link (
  id SERIAL PRIMARY KEY,
  "familyCodeLow" VARCHAR(255) NOT NULL,
  "familyCodeHigh" VARCHAR(255) NOT NULL,
  "nodeUidLow" UUID NOT NULL,
  "nodeUidHigh" UUID NOT NULL,
  "relationshipTypeLowToHigh" VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  "createdBy" INTEGER,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tree_link_low_family
    FOREIGN KEY ("familyCodeLow") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_tree_link_high_family
    FOREIGN KEY ("familyCodeHigh") REFERENCES public.ft_family("familyCode") ON DELETE CASCADE,
  CONSTRAINT fk_tree_link_created_by
    FOREIGN KEY ("createdBy") REFERENCES public.ft_user(id) ON DELETE SET NULL,
  CONSTRAINT uq_tree_link_pair UNIQUE ("familyCodeLow", "familyCodeHigh", "nodeUidLow", "nodeUidHigh", "relationshipTypeLowToHigh")
);

CREATE INDEX IF NOT EXISTS idx_ft_tree_link_low
  ON public.ft_tree_link ("familyCodeLow", "nodeUidLow");

CREATE INDEX IF NOT EXISTS idx_ft_tree_link_high
  ON public.ft_tree_link ("familyCodeHigh", "nodeUidHigh");
