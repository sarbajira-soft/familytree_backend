WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "memberId"
           ORDER BY "updatedAt" DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.ft_family_members
  WHERE "approveStatus" = 'pending'
)
UPDATE public.ft_family_members fm
SET "approveStatus" = 'cancelled',
    "removedAt" = COALESCE(fm."removedAt", CURRENT_TIMESTAMP)
FROM ranked r
WHERE fm.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ft_family_members_single_pending_request
  ON public.ft_family_members ("memberId")
  WHERE "approveStatus" = 'pending';
