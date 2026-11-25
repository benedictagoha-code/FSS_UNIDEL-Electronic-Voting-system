import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pool } from '../src/db.js';

try {
  const sql = await readFile(new URL('../db/migrations/001_initial_schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Database migration 001 applied successfully.');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
