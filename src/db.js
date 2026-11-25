import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

// Render's private Postgres endpoint supports TLS with a self-signed
// certificate. Use DATABASE_SSL_MODE=require there (encrypted transport,
// without CA verification). Keep certificate verification enabled by default
// for other production providers.
const databaseSslMode = process.env.DATABASE_SSL_MODE ||
  (process.env.NODE_ENV === 'production' ? 'verify-full' : 'disable');
const databaseSsl = databaseSslMode === 'disable'
  ? false
  : databaseSslMode === 'require'
    ? { rejectUnauthorized: false }
    : { rejectUnauthorized: true };

if (!['disable', 'require', 'verify-full'].includes(databaseSslMode)) {
  throw new Error('DATABASE_SSL_MODE must be disable, require, or verify-full.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSsl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (error) => {
  // Do not print SQL parameters or secrets.
  console.error('Unexpected database pool error:', error.message);
});
