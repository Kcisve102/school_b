import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { dbConfig } from '../../config/database';

const SALT_ROUNDS = 10;

/**
 * Creates (or promotes) an admin user.
 *
 * UserModel.create() never sets is_admin, so without this there is no code path
 * to create the first admin on a fresh deploy.
 *
 * Usage:
 *   npm run seed:admin -- <email> <password> "<full name>"
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... npm run seed:admin
 */
async function main(): Promise<void> {
  const [argEmail, argPassword, ...nameParts] = process.argv.slice(2);

  const email = argEmail || process.env.ADMIN_EMAIL;
  const password = argPassword || process.env.ADMIN_PASSWORD;
  const fullName = nameParts.join(' ') || process.env.ADMIN_NAME || 'Administrator';

  if (!email || !password) {
    console.error(
      'Usage: npm run seed:admin -- <email> <password> "<full name>"\n' +
        '   or: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed:admin'
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('❌ Password must be at least 8 characters');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
  });

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const [existing] = await conn.execute<mysql.RowDataPacket[]>(
      'SELECT id, is_admin FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      await conn.execute(
        'UPDATE users SET password_hash = ?, is_admin = TRUE WHERE email = ?',
        [passwordHash, email]
      );
      console.log(`✅ Existing user ${email} promoted to admin and password reset`);
    } else {
      await conn.execute(
        'INSERT INTO users (email, password_hash, full_name, is_admin) VALUES (?, ?, ?, TRUE)',
        [email, passwordHash, fullName]
      );
      console.log(`✅ Admin user created: ${email}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
