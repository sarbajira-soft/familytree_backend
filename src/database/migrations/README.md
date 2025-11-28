# Database Migrations

This directory contains all database migration files for the Family Tree application.

## Files

### `001-complete-schema-v3.sql`

**Purpose**: Complete database schema creation and setup

**Contents**:
- Enum types (11 total)
- Tables (29 total)
- Triggers (2 total)
- Indexes (47 total)
- Foreign key constraints
- Check constraints

**Features**:
- ✅ Idempotent (safe to run multiple times)
- ✅ Handles duplicate objects gracefully
- ✅ Comprehensive error handling
- ✅ Production ready

**Execution Time**: 5-30 seconds

## How Migrations Work

### Automatic Execution

Migrations run automatically when the application starts:

```bash
npm run start:prod
```

**Process**:
1. Application connects to database
2. Runs all migration files in alphabetical order
3. Each SQL statement is executed
4. Errors are handled gracefully
5. Schema status is verified
6. Sequelize associations are set up

### Manual Execution

Run migrations manually if needed:

```bash
# Connect to database and run migration
psql -h <host> -U <user> -d <database> -f src/database/migrations/001-complete-schema-v3.sql
```

### Programmatic Execution

Run migrations from Node.js:

```typescript
import { Sequelize } from 'sequelize-typescript';
import { runMigrations } from '../run-migration';

const sequelize = new Sequelize({...});
await runMigrations(sequelize);
```

## Migration Phases

### Phase 1: Enum Types
Creates all PostgreSQL enum types needed by tables.

```sql
CREATE TYPE enum_name AS ENUM ('value1', 'value2');
```

### Phase 2: Trigger Functions
Creates functions used by triggers for auto-updating timestamps.

```sql
CREATE FUNCTION update_timestamp() RETURNS trigger AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Phase 3: Tables
Creates all 29 database tables with proper structure.

```sql
CREATE TABLE table_name (
  id SERIAL PRIMARY KEY,
  column_name TYPE,
  ...
);
```

### Phase 4: Triggers
Creates triggers that automatically update timestamps.

```sql
CREATE TRIGGER trigger_name
BEFORE UPDATE ON table_name
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();
```

### Phase 5: Indexes
Creates 47 optimized indexes for query performance.

```sql
CREATE INDEX idx_name ON table_name(column_name);
```

## Idempotent Operations

All operations use `IF NOT EXISTS` or error handling:

### Safe Operations
```sql
-- ✅ Safe - will not error if exists
CREATE TABLE IF NOT EXISTS table_name (...);
CREATE INDEX IF NOT EXISTS idx_name ON table_name(...);

-- ✅ Safe - handles duplicate errors
DO $$ BEGIN
  CREATE TYPE enum_name AS ENUM (...);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
```

### Unsafe Operations (Avoided)
```sql
-- ❌ Unsafe - will error if exists
CREATE TABLE table_name (...);
CREATE INDEX idx_name ON table_name(...);
```

## Error Handling

### Expected Errors (Handled Gracefully)

These errors are expected and handled:
- "already exists" - Object already created
- "duplicate_object" - Enum type already exists
- "IF NOT EXISTS" - Conditional creation

**Log Output**:
```
ℹ️ already exists (not an error)
```

### Unexpected Errors (Will Fail)

These errors will cause migration to fail:
- Connection refused
- Permission denied
- Syntax errors
- Foreign key violations

**Log Output**:
```
❌ Migration failed: [error message]
```

## Verification

### Check Migration Status

```bash
# View application logs
tail -f logs/app.log

# Look for success message:
# ✅ All migrations completed successfully!
```

### Verify Schema

```bash
# Check tables
psql -h <host> -U <user> -d <database> -c "\dt"

# Check indexes
psql -h <host> -U <user> -d <database> -c "\di"

# Check enum types
psql -h <host> -U <user> -d <database> -c "SELECT typname FROM pg_type WHERE typtype = 'e';"
```

## Adding New Migrations

### Step 1: Create Migration File

Create a new file following the naming convention:

```
002-feature-name.sql
003-another-feature.sql
```

**Naming Convention**: `NNN-description.sql`
- NNN: Sequential number (001, 002, 003, etc.)
- description: Brief feature description

### Step 2: Write Idempotent SQL

```sql
-- ✅ Good: Idempotent
CREATE TABLE IF NOT EXISTS new_table (
  id SERIAL PRIMARY KEY,
  column_name VARCHAR(255)
);

-- ✅ Good: Handles duplicates
DO $$ BEGIN
  CREATE TYPE new_enum AS ENUM ('value1', 'value2');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ✅ Good: Conditional index
CREATE INDEX IF NOT EXISTS idx_new_index ON new_table(column_name);
```

### Step 3: Test Locally

```bash
# Test migration locally
npm run start:dev

# Check logs for success
tail -f logs/app.log
```

### Step 4: Deploy to EC2

```bash
# Deploy application (migrations run automatically)
npm run start:prod
```

## Rollback Strategy

### Backup Before Migration

```bash
pg_dump -h <host> -U <user> <database> > backup-$(date +%Y%m%d-%H%M%S).sql
```

### Restore from Backup

```bash
psql -h <host> -U <user> <database> < backup-20240101-120000.sql
```

### Create Rollback Migration

If needed, create a rollback migration:

```sql
-- 003-rollback-feature.sql
DROP TABLE IF EXISTS new_table;
DROP INDEX IF EXISTS idx_new_index;
DROP TYPE IF EXISTS new_enum;
```

## Performance Considerations

### Index Strategy

**Composite Indexes** for common multi-column queries:
```sql
CREATE INDEX idx_table_col1_col2 ON table_name(column1, column2);
```

**Partial Indexes** for filtered queries:
```sql
CREATE INDEX idx_table_active ON table_name(status) WHERE status = 'active';
```

**Unique Indexes** for constraints:
```sql
CREATE UNIQUE INDEX idx_table_unique ON table_name(column_name);
```

### Query Optimization

Use indexed columns in WHERE clauses:
```sql
-- ✅ Good (uses index)
SELECT * FROM table_name WHERE indexed_column = value;

-- ❌ Avoid (full table scan)
SELECT * FROM table_name WHERE non_indexed_column = value;
```

## Monitoring

### Check Migration Logs

```bash
# View application logs
tail -f logs/app.log

# Filter for migration messages
tail -f logs/app.log | grep -i migration

# Filter for errors
tail -f logs/app.log | grep -i error
```

### Monitor Database

```bash
# Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# Check index usage
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
WHERE schemaname = 'public' 
ORDER BY idx_scan DESC;
```

## Troubleshooting

### Migration Fails with "Connection Refused"

**Cause**: Cannot connect to database

**Solution**:
```bash
# Verify database is running
psql -h <host> -U <user> -d <database> -c "SELECT 1;"

# Check database credentials in .env
cat .env | grep DB_
```

### Migration Fails with "Permission Denied"

**Cause**: Database user lacks permissions

**Solution**:
```sql
-- Grant permissions to user
GRANT ALL PRIVILEGES ON DATABASE family_tree TO <user>;
GRANT ALL PRIVILEGES ON SCHEMA public TO <user>;
```

### Tables Not Created

**Cause**: Migration didn't run or failed silently

**Solution**:
```bash
# Check application logs
tail -f logs/app.log

# Run migration manually
psql -h <host> -U <user> -d <database> -f src/database/migrations/001-complete-schema-v3.sql

# Verify tables
psql -h <host> -U <user> -d <database> -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
```

## Best Practices

1. **Always Backup Before Migration**
   ```bash
   pg_dump -h <host> -U <user> <database> > backup.sql
   ```

2. **Test Locally First**
   ```bash
   npm run start:dev
   ```

3. **Use Idempotent Operations**
   ```sql
   CREATE TABLE IF NOT EXISTS table_name (...);
   ```

4. **Handle Errors Gracefully**
   ```sql
   DO $$ BEGIN
     CREATE TYPE enum_name AS ENUM (...);
   EXCEPTION
     WHEN duplicate_object THEN null;
   END $$;
   ```

5. **Monitor Execution**
   ```bash
   tail -f logs/app.log
   ```

6. **Verify Results**
   ```bash
   psql -h <host> -U <user> -d <database> -c "\dt"
   ```

## References

- **Migration Guide**: See `MIGRATION_GUIDE.md`
- **Schema Analysis**: See `SCHEMA_ANALYSIS.md`
- **Deployment Checklist**: See `DEPLOYMENT_CHECKLIST.md`
- **Migration Runner**: See `run-migration.ts`

## Support

For issues or questions:
1. Check logs: `tail -f logs/app.log`
2. Review troubleshooting section above
3. Verify database connectivity
4. Check PostgreSQL version (12+)

---

**Last Updated**: 2024
**Version**: 1.0
