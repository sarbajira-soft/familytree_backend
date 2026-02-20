-- Admin panel login table
-- Purpose: Fresh initial schema for admin panel authentication

CREATE TYPE public.admin_role AS ENUM ('admin', 'superadmin');

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.ft_admin_login (
  id SERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  "fullName" VARCHAR(255),
  role public.admin_role NOT NULL DEFAULT 'admin',
  status INTEGER NOT NULL DEFAULT 1,
  "lastLoginAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_ft_admin_login_uuid
  ON public.ft_admin_login(uuid);

CREATE INDEX IF NOT EXISTS idx_ft_admin_login_email
  ON public.ft_admin_login(email);

CREATE INDEX IF NOT EXISTS idx_ft_admin_login_role
  ON public.ft_admin_login(role);

CREATE INDEX IF NOT EXISTS idx_ft_admin_login_status
  ON public.ft_admin_login(status);
