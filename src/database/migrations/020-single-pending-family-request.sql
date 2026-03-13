DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = '"enum_ft_family_members_approveStatus"'::regtype
      AND enumlabel = 'cancelled'
  ) THEN
    ALTER TYPE public."enum_ft_family_members_approveStatus" ADD VALUE 'cancelled';
    RAISE NOTICE 'Added ''cancelled'' to enum_ft_family_members_approveStatus';
  ELSE
    RAISE NOTICE '''cancelled'' already exists in enum_ft_family_members_approveStatus';
  END IF;
END $$;
