-- Migration: Add 'removed' to enum_ft_family_members_approveStatus
-- This is needed for the member removal feature

DO $$
BEGIN
    -- Check if 'removed' value already exists in the enum
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumtypid = '"enum_ft_family_members_approveStatus"'::regtype 
        AND enumlabel = 'removed'
    ) THEN
        -- Add 'removed' to the enum
        ALTER TYPE public."enum_ft_family_members_approveStatus" ADD VALUE 'removed';
        RAISE NOTICE 'Added ''removed'' to enum_ft_family_members_approveStatus';
    ELSE
        RAISE NOTICE '''removed'' already exists in enum_ft_family_members_approveStatus';
    END IF;
END $$;
