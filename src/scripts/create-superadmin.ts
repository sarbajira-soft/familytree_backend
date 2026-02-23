import 'dotenv/config';
import { Sequelize } from 'sequelize-typescript';
import * as bcrypt from 'bcrypt';

import { AdminLogin } from '../admin/model/admin-login.model';

const getArgValue = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
};

async function main() {
  const emailRaw = getArgValue('--email') || getArgValue('-e');
  const password = getArgValue('--password') || getArgValue('-p');
  const fullName = getArgValue('--name') || getArgValue('-n');

  if (!emailRaw || !password) {
    throw new Error(
      'Missing args. Usage: npm run admin:create-superadmin -- --email <email> --password <password> [--name "Full Name"]',
    );
  }

  const email = String(emailRaw).trim().toLowerCase();

  const sequelize = new Sequelize({
    dialect: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    models: [AdminLogin],
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  });

  try {
    await sequelize.authenticate();

    const existing = await AdminLogin.findOne({ where: { email } });
    if (existing) {
      await existing.update({
        password: await bcrypt.hash(password, 12),
        fullName: fullName ?? existing.fullName,
        role: 'superadmin',
        status: 1,
      });
      // eslint-disable-next-line no-console
      console.log(`Updated existing admin to superadmin: ${email}`);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    await AdminLogin.create({
      email,
      password: hashedPassword,
      fullName: fullName ?? null,
      role: 'superadmin',
      status: 1,
    } as any);

    // eslint-disable-next-line no-console
    console.log(`Created superadmin: ${email}`);
  } finally {
    await sequelize.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
