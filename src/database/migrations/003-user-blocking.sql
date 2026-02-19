-- User-to-User Blocking (personal blocks)

CREATE TABLE IF NOT EXISTS public.ft_user_block (
  id SERIAL PRIMARY KEY,
  "blockerUserId" INTEGER NOT NULL,
  "blockedUserId" INTEGER NOT NULL,
  "blockType" VARCHAR(20) NOT NULL DEFAULT 'USER',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.ft_user_block
  DROP CONSTRAINT IF EXISTS fk_ft_user_block_blocker;
ALTER TABLE public.ft_user_block
  ADD CONSTRAINT fk_ft_user_block_blocker
  FOREIGN KEY ("blockerUserId") REFERENCES public.ft_user(id) ON DELETE CASCADE;

ALTER TABLE public.ft_user_block
  DROP CONSTRAINT IF EXISTS fk_ft_user_block_blocked;
ALTER TABLE public.ft_user_block
  ADD CONSTRAINT fk_ft_user_block_blocked
  FOREIGN KEY ("blockedUserId") REFERENCES public.ft_user(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_ft_user_block_blocker ON public.ft_user_block("blockerUserId");
CREATE INDEX IF NOT EXISTS idx_ft_user_block_blocked ON public.ft_user_block("blockedUserId");
CREATE INDEX IF NOT EXISTS idx_ft_user_block_active_pair ON public.ft_user_block("blockerUserId", "blockedUserId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS idx_ft_user_block_active_reverse_pair ON public.ft_user_block("blockedUserId", "blockerUserId") WHERE "deletedAt" IS NULL;

-- BLOCK OVERRIDE: Active uniqueness now depends only on blocker/blocked pair.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_block
  ON public.ft_user_block("blockerUserId", "blockedUserId")
  WHERE "deletedAt" IS NULL;

-- Performance: common lookup for family membership checks
CREATE INDEX IF NOT EXISTS idx_ft_family_members_member_family
  ON public.ft_family_members("memberId", "familyCode");
