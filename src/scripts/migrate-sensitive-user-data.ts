import 'dotenv/config';
import 'reflect-metadata';
import { Sequelize } from 'sequelize-typescript';
import { ensureFieldEncryptionConfigured, isEncryptedValue } from '../common/security/field-encryption.util';
import { User } from '../user/model/user.model';
import { UserProfile } from '../user/model/user-profile.model';

async function migrateUsers() {
  const users = await User.findAll({
    attributes: ['id', 'email', 'mobile', 'emailHash', 'mobileHash'],
    order: [['id', 'ASC']],
  });

  let updatedUsers = 0;

  for (const user of users) {
    const rawEmail = user.getDataValue('email');
    const rawMobile = user.getDataValue('mobile');
    const decryptedEmail = user.email;
    const decryptedMobile = user.mobile;
    let changed = false;

    if (decryptedEmail && (!isEncryptedValue(rawEmail) || !user.getDataValue('emailHash'))) {
      user.email = decryptedEmail;
      changed = true;
    }

    if (decryptedMobile && (!isEncryptedValue(rawMobile) || !user.getDataValue('mobileHash'))) {
      user.mobile = decryptedMobile;
      changed = true;
    }

    if (changed) {
      await user.save();
      updatedUsers++;
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
      await profile.save();
      updatedProfiles++;
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

    const [updatedUsers, updatedProfiles] = await Promise.all([
      migrateUsers(),
      migrateProfiles(),
    ]);

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
