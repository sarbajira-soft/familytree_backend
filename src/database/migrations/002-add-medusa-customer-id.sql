ALTER TABLE public.ft_user
  ADD COLUMN IF NOT EXISTS "medusaCustomerId" VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_ft_user_medusa_customer_id
  ON public.ft_user("medusaCustomerId");
