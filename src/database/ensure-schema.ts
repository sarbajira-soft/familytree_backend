import { Sequelize } from 'sequelize-typescript';

/**
 * Ensures all required columns exist in the database
 * Uses IF NOT EXISTS for idempotent schema updates
 */
export async function ensureSchemaUpdates(sequelize: Sequelize): Promise<void> {
  console.log('Ensuring database schema is up to date...');

  try {
    // Add lifeStatus column if it doesn't exist
    await sequelize.query(`
      ALTER TABLE ft_family_tree 
      ADD COLUMN IF NOT EXISTS "lifeStatus" VARCHAR(255) DEFAULT 'living' NOT NULL;
    `);

    // Create enum type if it doesn't exist
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_ft_family_tree_lifeStatus AS ENUM('living', 'remembering');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Convert column to enum type (only if it's not already enum)
    await sequelize.query(`
      DO $$ BEGIN
        ALTER TABLE ft_family_tree 
        ALTER COLUMN "lifeStatus" TYPE enum_ft_family_tree_lifeStatus 
        USING "lifeStatus"::enum_ft_family_tree_lifeStatus;
      EXCEPTION
        WHEN OTHERS THEN null;
      END $$;
    `);

    // Add more schema updates here as needed
    // Example: Add new column
    // await sequelize.query(`
    //   ALTER TABLE ft_user_profile 
    //   ADD COLUMN IF NOT EXISTS "phoneNumber" VARCHAR(20);
    // `);

    console.log('✅ Schema updates completed successfully');
  } catch (error) {
    console.error('❌ Schema update failed:', error.message);
    throw error;
  }
}
