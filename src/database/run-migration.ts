import { Sequelize } from 'sequelize-typescript';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Database Migration Runner
 * Executes SQL migration files in order
 * Safe for EC2 deployment - idempotent operations
 */
export async function runMigrations(sequelize: Sequelize): Promise<void> {
  console.log('🚀 Starting database migrations...');

  try {
    // Get all migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      console.warn('⚠️  Migrations directory not found. Skipping migrations.');
      return;
    }

    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      console.warn('⚠️  No migration files found.');
      return;
    }

    console.log(`📋 Found ${migrationFiles.length} migration file(s)`);

    // Execute each migration file
    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      console.log(`\n📝 Executing migration: ${file}`);

      try {
        const sql = fs.readFileSync(filePath, 'utf-8');
        
        // Split by semicolons and execute each statement
        const statements = sql
          .split(';')
          .map((stmt) => stmt.trim())
          .filter((stmt) => stmt.length > 0);

        for (const statement of statements) {
          try {
            await sequelize.query(statement);
          } catch (error) {
            // Log but don't fail on idempotent operations (e.g., CREATE IF NOT EXISTS)
            if (
              error.message.includes('already exists') ||
              error.message.includes('duplicate') ||
              error.message.includes('IF NOT EXISTS')
            ) {
              console.log(`   ℹ️  ${error.message.substring(0, 80)}...`);
            } else {
              throw error;
            }
          }
        }

        console.log(`✅ Migration completed: ${file}`);
      } catch (error) {
        console.error(`❌ Migration failed: ${file}`);
        console.error(`   Error: ${error.message}`);
        throw error;
      }
    }

    console.log('\n✅ All migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration process failed:', error.message);
    throw error;
  }
}

/**
 * Check migration status
 */
export async function checkMigrationStatus(sequelize: Sequelize): Promise<void> {
  try {
    console.log('\n📊 Checking database schema status...');

    // Check enum types
    const enums = await sequelize.query(`
      SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname;
    `);
    console.log(`   Enum types: ${(enums[0] as any[]).length} found`);

    // Check tables
    const tables = await sequelize.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
    `);
    console.log(`   Tables: ${(tables[0] as any[]).length} found`);

    // Check indexes
    const indexes = await sequelize.query(`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;
    `);
    console.log(`   Indexes: ${(indexes[0] as any[]).length} found`);

    console.log('✅ Schema status check completed');
  } catch (error) {
    console.error('❌ Schema status check failed:', error.message);
  }
}
