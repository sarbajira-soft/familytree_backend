-- BLOCK OVERRIDE: Replace legacy family-member block columns and ensure user-to-user block schema.
ALTER TABLE IF EXISTS public.ft_family_members
  DROP COLUMN IF EXISTS "isBlocked",
  DROP COLUMN IF EXISTS "blockedByUserId",
  DROP COLUMN IF EXISTS "blockedAt";

-- BLOCK OVERRIDE: Clean up legacy block table variants if present.
DROP TABLE IF EXISTS public.ft_block;

-- BLOCK OVERRIDE: Recreate canonical user block table used by the new block module.
CREATE TABLE IF NOT EXISTS public.ft_user_block (
  id SERIAL PRIMARY KEY,
  "blockerUserId" INTEGER NOT NULL REFERENCES public.ft_user(id),
  "blockedUserId" INTEGER NOT NULL REFERENCES public.ft_user(id),
  "blockType" VARCHAR(255) NOT NULL DEFAULT 'USER',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMP WITH TIME ZONE
);

-- BLOCK OVERRIDE: Ensure unique active block pair and remove legacy index variants.
DROP INDEX IF EXISTS public.uidx_ft_user_block_active_unique;
DROP INDEX IF EXISTS public.idx_ft_user_block_active_pair;
DROP INDEX IF EXISTS public.idx_ft_user_block_active_reverse_pair;

ALTER TABLE public.ft_user_block
  DROP CONSTRAINT IF EXISTS unique_active_block;

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_block
  ON public.ft_user_block ("blockerUserId", "blockedUserId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_ft_user_block_blocker
  ON public.ft_user_block ("blockerUserId");

CREATE INDEX IF NOT EXISTS idx_ft_user_block_blocked
  ON public.ft_user_block ("blockedUserId");
