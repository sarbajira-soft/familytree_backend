CREATE TABLE IF NOT EXISTS public.ft_content_report (
  id SERIAL PRIMARY KEY,
  "targetType" VARCHAR(16) NOT NULL,
  "targetId" INTEGER NOT NULL,
  "reportedByUserId" INTEGER NOT NULL,
  reason VARCHAR(64) NOT NULL,
  description TEXT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'open',
  "reviewedByAdminId" INTEGER NULL,
  "reviewedAt" TIMESTAMPTZ NULL,
  "adminNote" TEXT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_ft_content_report_target_type CHECK ("targetType" IN ('post', 'gallery', 'event')),
  CONSTRAINT chk_ft_content_report_status CHECK (status IN ('open', 'reviewed', 'dismissed', 'action_taken')),
  CONSTRAINT fk_ft_content_report_reported_by_user FOREIGN KEY ("reportedByUserId") REFERENCES public.ft_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ft_content_report_target ON public.ft_content_report ("targetType", "targetId");
CREATE INDEX IF NOT EXISTS idx_ft_content_report_status ON public.ft_content_report (status);
CREATE INDEX IF NOT EXISTS idx_ft_content_report_createdAt ON public.ft_content_report ("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ft_content_report_open
  ON public.ft_content_report ("targetType", "targetId", "reportedByUserId")
  WHERE status = 'open';
