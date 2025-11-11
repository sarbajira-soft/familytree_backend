/**
 * Database Schema Checker
 * 
 * This script checks the actual database schema to understand
 * what columns exist in each table
 */

const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'family_tree',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    },
    connectTimeout: 60000,
    requestTimeout: 60000,
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 60000,
    idle: 10000
  },
  retry: {
    max: 3,
  }
});

async function checkSchema() {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('  DATABASE SCHEMA CHECKER');
    console.log('  Date: ' + new Date().toISOString());
    console.log('='.repeat(70) + '\n');

    console.log('🔌 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected successfully\n');

    // Check notification_recipients table
    console.log('=' .repeat(70));
    console.log('📋 FT_NOTIFICATION_RECIPIENTS TABLE');
    console.log('='.repeat(70));
    const [notifCols] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'ft_notification_recipients'
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    console.table(notifCols);

    // Check ft_order table
    console.log('\n' + '='.repeat(70));
    console.log('📋 FT_ORDER TABLE');
    console.log('='.repeat(70));
    const [orderCols] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'ft_order'
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    if (orderCols.length > 0) {
      console.table(orderCols);
    } else {
      console.log('⚠️  Table does not exist\n');
    }

    // Check ft_invite table
    console.log('\n' + '='.repeat(70));
    console.log('📋 FT_INVITE TABLE');
    console.log('='.repeat(70));
    const [inviteCols] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'ft_invite'
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    console.table(inviteCols);

    // Check ft_event table
    console.log('\n' + '='.repeat(70));
    console.log('📋 FT_EVENT TABLE');
    console.log('='.repeat(70));
    const [eventCols] = await sequelize.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'ft_event'
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    console.table(eventCols);

    // Check existing indexes
    console.log('\n' + '='.repeat(70));
    console.log('📊 EXISTING COUNT-RELATED INDEXES');
    console.log('='.repeat(70));
    const [indexes] = await sequelize.query(`
      SELECT 
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND (
        tablename IN ('ft_notification_recipients', 'ft_post_like', 'ft_post_comment', 
                      'ft_gallery_like', 'ft_gallery_comment', 'ft_event', 
                      'ft_family_members', 'ft_user_profile', 'ft_order', 'ft_invite')
      )
      ORDER BY tablename, indexname;
    `);
    console.table(indexes.map(idx => ({
      table: idx.tablename,
      index: idx.indexname,
    })));

    // Check table row counts
    console.log('\n' + '='.repeat(70));
    console.log('📊 TABLE ROW COUNTS');
    console.log('='.repeat(70));
    const tables = [
      'ft_notification_recipients',
      'ft_post_like',
      'ft_post_comment',
      'ft_gallery_like',
      'ft_gallery_comment',
      'ft_event',
      'ft_family_members',
      'ft_user_profile',
      'ft_order',
      'ft_invite'
    ];

    const counts = [];
    for (const table of tables) {
      try {
        const [result] = await sequelize.query(`SELECT COUNT(*) as count FROM ${table}`);
        counts.push({ table, count: result[0].count });
      } catch (err) {
        counts.push({ table, count: 'N/A (table may not exist)' });
      }
    }
    console.table(counts);

    console.log('\n' + '='.repeat(70));
    console.log('✅ Schema Check Complete!');
    console.log('='.repeat(70) + '\n');

  } catch (error) {
    console.error('\n❌ Schema check failed:');
    console.error('Error:', error.message);
    if (error.original) {
      console.error('Original Error:', error.original.message);
    }
    process.exit(1);
  } finally {
    await sequelize.close();
    console.log('🔌 Database connection closed\n');
  }
}

checkSchema()
  .then(() => {
    console.log('✅ Script completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  });
