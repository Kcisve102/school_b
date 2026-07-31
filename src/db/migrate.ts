import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { dbConfig } from '../config/database';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Migrations that were applied by hand before this runner existed.
 * `--baseline` records them as applied without executing them.
 */
const BASELINE_VERSIONS = [
  '001_create_users_table.sql',
  '002_create_videos_table.sql',
  '003_create_transcriptions_table.sql',
  '004_create_summaries_table.sql',
  '005_create_sessions_table.sql',
  '008_add_category_to_videos.sql',
  '009_create_video_watches_table.sql',
  '010_create_quiz_attempts_table.sql',
];

async function ensureMigrationsTable(conn: mysql.Connection): Promise<void> {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version VARCHAR(255) PRIMARY KEY,
       applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     )`
  );
}

async function getAppliedVersions(conn: mysql.Connection): Promise<Set<string>> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT version FROM schema_migrations'
  );
  return new Set(rows.map((row) => row.version as string));
}

function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/**
 * Split a migration file into individual statements.
 * Strips `--` line comments so semicolons inside them are not treated as
 * statement terminators.
 */
function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function runBaseline(conn: mysql.Connection): Promise<void> {
  const applied = await getAppliedVersions(conn);
  const files = getMigrationFiles();

  let recorded = 0;
  for (const version of BASELINE_VERSIONS) {
    if (applied.has(version)) continue;

    if (!files.includes(version)) {
      console.warn(`⚠️  Baseline lists ${version} but the file is missing — skipping`);
      continue;
    }

    await conn.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    console.log(`📌 Baselined (marked applied, not executed): ${version}`);
    recorded++;
  }

  console.log(
    recorded === 0
      ? '✅ Baseline already recorded — nothing to do'
      : `✅ Baseline complete — ${recorded} migration(s) marked as applied`
  );
}

async function runMigrations(conn: mysql.Connection): Promise<void> {
  const applied = await getAppliedVersions(conn);
  const files = getMigrationFiles();
  const pending = files.filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log('✅ No pending migrations — database is up to date');
    return;
  }

  console.log(`Found ${pending.length} pending migration(s)\n`);

  for (const version of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, version), 'utf8');
    const statements = splitStatements(sql);

    if (statements.length === 0) {
      console.log(`⏭️  ${version} — no statements, recording as applied`);
      await conn.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
      continue;
    }

    console.log(`▶️  Applying ${version} (${statements.length} statement(s))...`);

    // DDL in MySQL causes an implicit commit, so a transaction cannot roll back
    // a partially-applied migration. We still wrap it so the version record and
    // any DML stay consistent, and abort immediately on the first failure.
    await conn.beginTransaction();
    try {
      for (const statement of statements) {
        await conn.query(statement);
      }
      await conn.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
      await conn.commit();
      console.log(`✅ Applied ${version}\n`);
    } catch (error: any) {
      await conn.rollback();
      console.error(`❌ Failed applying ${version}: ${error.message}`);
      console.error(
        '   Note: MySQL implicitly commits DDL, so this migration may be ' +
          'partially applied. Inspect the schema before re-running.'
      );
      throw error;
    }
  }

  console.log('✅ All migrations applied');
}

async function main(): Promise<void> {
  const isBaseline = process.argv.includes('--baseline');

  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
  });

  try {
    await ensureMigrationsTable(conn);
    if (isBaseline) {
      await runBaseline(conn);
    } else {
      await runMigrations(conn);
    }
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
