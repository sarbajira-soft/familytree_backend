/**
 * Run database migration
 * Usage: node migrations/run-migration.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const config = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false
  }
};

async function runMigration() {
  const client = new Client(config);
  
  try {
    console.log('');
    console.log('='.repeat(60));
    console.log('🚀 RUNNING DATABASE MIGRATION');
    console.log('='.repeat(60));
    console.log('');
    
    console.log('📋 Database:', process.env.DB_NAME);
    console.log('🔌 Host:', process.env.DB_HOST);
    console.log('');
    
    console.log('Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Read migration file
    const migrationFile = path.join(__dirname, 'complete-schema-v2.sql');
    console.log('📄 Reading migration file:', migrationFile);
    const sql = fs.readFileSync(migrationFile, 'utf8');
    console.log('✅ Migration file loaded\n');

    // Run migration
    console.log('🔄 Executing migration...');
    console.log('');
    await client.query(sql);
    
    console.log('');
    console.log('='.repeat(60));
    console.log('✅ MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log('');
    
    // Verify tables
    const result = await client.query(`
      SELECT COUNT(*) as count 
      FROM pg_tables 
      WHERE schemaname = 'public'
    `);
    
    const tableCount = result.rows[0].count;
    console.log(`📊 Total tables in database: ${tableCount}`);
    
    if (tableCount >= 29) {
      console.log('✅ All tables created successfully!');
    } else {
      console.log(`⚠️  Expected at least 29 tables, found ${tableCount}`);
    }
    
    console.log('');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('❌ MIGRATION FAILED!');
    console.error('='.repeat(60));
    console.error('');
    console.error('Error:', error.message);
    console.error('');
    if (error.position) {
      console.error('Position:', error.position);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
