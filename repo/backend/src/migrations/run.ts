import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

async function runMigrations(): Promise<void> {
  const pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
  });

  try {
    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get already applied migrations
    const result = await pool.query('SELECT filename FROM schema_migrations ORDER BY id');
    const applied = new Set(result.rows.map((r: { filename: string }) => r.filename));

    // Read migration files
    const migrationsDir = path.join(__dirname);
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Migration already applied: ${file}`);
        continue;
      }

      console.log(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        console.log(`Migration applied: ${file}`);
      } catch (err) {
        await pool.query('ROLLBACK');
        console.error(`Migration failed: ${file}`, err);
        throw err;
      }
    }

    console.log('All migrations applied successfully');
  } finally {
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('Migration runner failed:', err);
  process.exit(1);
});
