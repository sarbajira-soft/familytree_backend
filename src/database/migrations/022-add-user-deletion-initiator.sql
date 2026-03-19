-- Track who initiated user account deletion

ALTER TABLE public.ft_user
  ADD COLUMN IF NOT EXISTS "deletedByAdminId" INTEGER,
  ADD COLUMN IF NOT EXISTS "deletedByUserId" INTEGER;

CREATE INDEX IF NOT EXISTS idx_ft_user_deleted_by_admin_id ON public.ft_user("deletedByAdminId");
CREATE INDEX IF NOT EXISTS idx_ft_user_deleted_by_user_id ON public.ft_user("deletedByUserId");
