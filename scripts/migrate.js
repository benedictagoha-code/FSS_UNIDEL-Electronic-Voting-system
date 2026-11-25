import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { pool } from '../src/db.js';

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const directory = new URL('../db/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\\d+_[a-z0-9_-]+\\.sql$/i.test(name)).sort();
  for (const filename of files) {
    const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename]);
    if (existing.rowCount) { console.log('Already applied:', filename); continue; }
    const sql = await readFile(new URL(filename, directory), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
      await client.query('COMMIT');
      console.log('Applied:', filename);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  console.log('Database migrations complete.');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
