import 'dotenv/config';
import 'reflect-metadata';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  buildEmailHash,
  buildMobileHash,
  ensureFieldEncryptionConfigured,
  isEncryptedValue,
} from '../common/security/field-encryption.util';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';

async function migrateUsers() {
  const users = await User.findAll({
    order: [['id', 'ASC']],
  });

  let updatedUsers = 0;

  for (const user of users) {
    try {
      const id = Number(user.getDataValue('id'));
      const rawEmail = user.getDataValue('email');
      const rawMobile = user.getDataValue('mobile');
      const decryptedEmail = user.email;
      const decryptedMobile = user.mobile;
      let changed = false;

      const nextEmailHash = decryptedEmail ? buildEmailHash(decryptedEmail) : null;
      const nextMobileHash = decryptedMobile ? buildMobileHash(decryptedMobile) : null;

      const emailHashConflict =
        nextEmailHash &&
        (await User.findOne({
          attributes: ['id'],
          where: {
            emailHash: nextEmailHash,
            id: { [Op.ne]: id },
          } as any,
        }));

      const mobileHashConflict =
        nextMobileHash &&
        (await User.findOne({
          attributes: ['id'],
          where: {
            mobileHash: nextMobileHash,
            id: { [Op.ne]: id },
          } as any,
        }));

      if (decryptedEmail && (!isEncryptedValue(rawEmail) || !user.getDataValue('emailHash'))) {
        if (emailHashConflict) {
          console.warn('Skipping user email migration due to emailHash conflict', {
            id,
            conflictUserId: emailHashConflict.getDataValue('id'),
          });
        } else {
          user.email = decryptedEmail;
          changed = true;
        }
      }

      if (decryptedMobile && (!isEncryptedValue(rawMobile) || !user.getDataValue('mobileHash'))) {
        if (mobileHashConflict) {
          console.warn('Skipping user mobile migration due to mobileHash conflict', {
            id,
            conflictUserId: mobileHashConflict.getDataValue('id'),
          });
        } else {
          user.mobile = decryptedMobile;
          changed = true;
        }
      }

      if (changed) {
        await user.save({
          fields: ['email', 'emailHash', 'mobile', 'mobileHash'],
          validate: false,
        });
        updatedUsers++;
      }
    } catch (error: any) {
      const id = user.getDataValue('id');
      const details = Array.isArray(error?.errors)
        ? error.errors.map((e: any) => ({ message: e?.message, path: e?.path, value: e?.value }))
        : undefined;
      console.error('User migration failed:', { id, message: error?.message, details });
      throw error;
    }
  }

  return updatedUsers;
}

async function migrateProfiles() {
  const profiles = await UserProfile.findAll({
    attributes: [
      'id',
      'userId',
      'dob',
      'contactNumber',
      'address',
      'emailPrivacy',
      'addressPrivacy',
      'phonePrivacy',
      'dobPrivacy',
    ],
    order: [['id', 'ASC']],
  });

  let updatedProfiles = 0;

  for (const profile of profiles) {
    try {
      const rawDob = profile.getDataValue('dob');
      const rawContactNumber = profile.getDataValue('contactNumber');
      const rawAddress = profile.getDataValue('address');
      let changed = false;

      if (profile.dob && (!rawDob || !isEncryptedValue(rawDob))) {
        profile.dob = profile.dob as any;
        changed = true;
      }

      if (profile.contactNumber && (!rawContactNumber || !isEncryptedValue(rawContactNumber))) {
        profile.contactNumber = profile.contactNumber;
        changed = true;
      }

      if (profile.address && (!rawAddress || !isEncryptedValue(rawAddress))) {
        profile.address = profile.address;
        changed = true;
      }

      if (!profile.emailPrivacy) {
        profile.emailPrivacy = 'FAMILY';
        changed = true;
      }

      if (!profile.addressPrivacy) {
        profile.addressPrivacy = 'FAMILY';
        changed = true;
      }

      if (!profile.phonePrivacy) {
        profile.phonePrivacy = 'FAMILY';
        changed = true;
      }

      if (!profile.dobPrivacy) {
        profile.dobPrivacy = 'FAMILY';
        changed = true;
      }

      if (changed) {
        await profile.save({ validate: false });
        updatedProfiles++;
      }
    } catch (error: any) {
      const id = profile.getDataValue('id');
      const userId = profile.getDataValue('userId');
      const details = Array.isArray(error?.errors)
        ? error.errors.map((e: any) => ({ message: e?.message, path: e?.path, value: e?.value }))
        : undefined;
      console.error('Profile migration failed:', { id, userId, message: error?.message, details });
      throw error;
    }
  }

  return updatedProfiles;
}

async function main() {
  ensureFieldEncryptionConfigured();

  const sequelize = new Sequelize({
    dialect: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    logging: false,
    models: [User, UserProfile],
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  });

  try {
    await sequelize.authenticate();

    const updatedUsers = await migrateUsers();
    const updatedProfiles = await migrateProfiles();

    console.log(
      `Sensitive data migration complete. Users updated: ${updatedUsers}. Profiles updated: ${updatedProfiles}.`,
    );
  } finally {
    await sequelize.close();
  }
}

main().catch((error) => {
  console.error('Sensitive data migration failed:', error?.message || error);
  process.exitCode = 1;
});
