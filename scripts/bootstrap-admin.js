import 'dotenv/config';
import { pool } from '../src/db.js';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const matricNumber = String(process.argv[2] || '').trim().toUpperCase();
if (!/^[A-Z0-9/-]{4,40}$/.test(matricNumber)) {
  console.error('Usage: npm run admin:bootstrap -- MATRIC_OR_REGISTRATION_NUMBER');
  process.exit(1);
}
if (process.env.ADMIN_BOOTSTRAP_CONFIRM !== 'I_HAVE_SECURED_DATABASE_ACCESS') {
  console.error('Set ADMIN_BOOTSTRAP_CONFIRM=I_HAVE_SECURED_DATABASE_ACCESS for this one-time operation.');
  process.exit(1);
}

const rl = createInterface({ input, output });
try {
  const confirm = await rl.question(`Grant the first super_admin role to account ${matricNumber}? Type YES to continue: `);
  if (confirm !== 'YES') throw new Error('Cancelled.');
  await pool.query('BEGIN');
  const existingAdmins = await pool.query('SELECT COUNT(*)::int AS count FROM admin_roles');
  if (existingAdmins.rows[0].count !== 0) throw new Error('Bootstrap is closed because an administrator role already exists.');
  const user = await pool.query('SELECT id FROM users WHERE matric_number = $1 FOR UPDATE', [matricNumber]);
  if (!user.rowCount) throw new Error('No registered student account matches that matriculation/registration number.');
  await pool.query(
    "INSERT INTO admin_roles (user_id, role) VALUES ($1, 'super_admin')",
    [user.rows[0].id]
  );
  await pool.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, 'admin.bootstrap', 'user', $1, '{"role":"super_admin"}'::jsonb)`,
    [user.rows[0].id]
  );
  await pool.query('COMMIT');
  console.log('First super administrator role created. Sign in with the existing student account.');
} catch (error) {
  await pool.query('ROLLBACK').catch(() => {});
  console.error('Administrator bootstrap failed:', error.message);
  process.exitCode = 1;
} finally {
  rl.close();
  await pool.end();
}
