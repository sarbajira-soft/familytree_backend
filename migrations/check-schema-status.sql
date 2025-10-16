-- Check current database schema status
-- Run this to see what's missing

-- 1. Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
    AND table_name IN ('ft_notifications', 'ft_family_tree', 'ft_family_members', 'ft_notification_recipients');

-- 2. Check ENUM types
SELECT typname, array_agg(enumlabel ORDER BY enumsortorder) as enum_values
FROM pg_type t 
JOIN pg_enum e ON t.oid = e.enumtypid 
WHERE typname LIKE '%enum%'
GROUP BY typname;

-- 3. Check specific columns
SELECT 
    table_name, 
    column_name, 
    data_type, 
    udt_name,
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name IN ('ft_notifications', 'ft_family_tree', 'ft_family_members')
    AND column_name IN ('status', 'actionType', 'lifeStatus', 'approveStatus')
ORDER BY table_name, column_name;

-- 4. Check indexes
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename IN ('ft_notifications', 'ft_family_tree', 'ft_family_members')
ORDER BY tablename, indexname;
