import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();
const moderationSchema = z.object({
  action: z.enum(['mute','suspend','deactivate','restore']),
  reason: z.string().trim().min(5).max(1000),
  durationHours: z.number().int().min(1).max(8760).optional()
});

function maskPhone(value) {
  if (!value || value.length < 7) return 'Hidden';
  return value.slice(0, 4) + '••••' + value.slice(-3);
}


const roleSchema = z.object({
  role: z.enum(['super_admin','election_admin','finance_admin','moderator','results_officer'])
});

router.get('/administrators', requireAdmin(['super_admin']), async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.matric_number, p.full_name, ar.role, ar.created_at
       FROM admin_roles ar
       JOIN users u ON u.id = ar.user_id
       JOIN student_profiles p ON p.user_id = u.id
       ORDER BY p.full_name, ar.role`
    );
    res.json({ administrators: result.rows });
  } catch (error) { next(error); }
});

router.post('/administrators/:userId/roles', requireAdmin(['super_admin']), async (req, res, next) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Select a valid administrator role.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(
      "SELECT id FROM users WHERE id = $1 AND account_status = 'active' FOR UPDATE",
      [req.params.userId]
    );
    if (!user.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active student account not found.' });
    }
    await client.query(
      `INSERT INTO admin_roles (user_id, role, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, created_at = NOW()`,
      [req.params.userId, parsed.data.role, req.session.userId]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'admin.role_granted', 'user', $2, $3::jsonb)`,
      [req.session.userId, req.params.userId, JSON.stringify({ role: parsed.data.role })]
    );
    await client.query('COMMIT');
    res.json({ message: 'Administrator role assigned.' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

router.delete('/administrators/:userId/roles', requireAdmin(['super_admin']), async (req, res, next) => {
  if (req.params.userId === req.session.userId) return res.status(400).json({ error: 'You cannot remove your own administrator role.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const removed = await client.query('DELETE FROM admin_roles WHERE user_id = $1 RETURNING role', [req.params.userId]);
    if (!removed.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Administrator role not found.' });
    }
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'admin.role_revoked', 'user', $2, $3::jsonb)`,
      [req.session.userId, req.params.userId, JSON.stringify({ previousRole: removed.rows[0].role })]
    );
    await client.query('COMMIT');
    res.json({ message: 'Administrator role removed.' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

router.get('/me', requireAdmin(), (req, res) => {
  res.json({ roles: req.adminRoles });
});

router.get('/users', requireAdmin(['super_admin','moderator']), async (req, res, next) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const status = ['active','suspended','deactivated'].includes(req.query.status) ? req.query.status : null;
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '50', 10) || 50, 1), 100);
  const offset = Math.max(Number.parseInt(req.query.offset || '0', 10) || 0, 0);
  try {
    const result = await pool.query(
      `SELECT u.id, u.matric_number, u.account_status, u.muted_until, u.created_at,
              p.full_name, p.department, p.level, u.phone_e164
       FROM users u JOIN student_profiles p ON p.user_id = u.id
       WHERE ($1::text IS NULL OR u.account_status = $1)
         AND ($2::text = '' OR
              u.matric_number ILIKE '%' || $2 || '%' OR
              p.full_name ILIKE '%' || $2 || '%' OR
              p.department ILIKE '%' || $2 || '%' OR
              p.level ILIKE '%' || $2 || '%')
       ORDER BY p.full_name ASC LIMIT $3 OFFSET $4`,
      [status, search, limit, offset]
    );
    res.json({
      users: result.rows.map(({ phone_e164, ...user }) => ({ ...user, phoneMasked: maskPhone(phone_e164) })),
      limit, offset
    });
  } catch (error) { next(error); }
});

router.post('/users/:userId/moderation', requireAdmin(['super_admin','moderator']), async (req, res, next) => {
  const parsed = moderationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Provide a valid moderation action and reason.', details: parsed.error.flatten().fieldErrors });
  if (req.params.userId === req.session.userId && ['suspend','deactivate'].includes(parsed.data.action)) {
    return res.status(400).json({ error: 'You cannot suspend or deactivate your own account.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.params.userId]);
    if (!target.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student account not found.' });
    }

    const { action, reason, durationHours } = parsed.data;
    let endsAt = null;
    if (action === 'mute') {
      if (!durationHours) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'A mute duration in hours is required.' });
      }
      endsAt = new Date(Date.now() + durationHours * 3600000);
      await client.query('UPDATE users SET muted_until = $1, updated_at = NOW() WHERE id = $2', [endsAt, req.params.userId]);
    } else if (action === 'suspend') {
      await client.query("UPDATE users SET account_status = 'suspended', updated_at = NOW() WHERE id = $1", [req.params.userId]);
    } else if (action === 'deactivate') {
      await client.query("UPDATE users SET account_status = 'deactivated', updated_at = NOW() WHERE id = $1", [req.params.userId]);
    } else {
      await client.query("UPDATE users SET account_status = 'active', muted_until = NULL, updated_at = NOW() WHERE id = $1", [req.params.userId]);
    }

    await client.query(
      `INSERT INTO moderation_actions (target_user_id, actor_user_id, action, reason, ends_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.userId, req.session.userId, action, reason, endsAt]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'user', $3, $4::jsonb)`,
      [req.session.userId, `user.${action}`, req.params.userId, JSON.stringify({ reason, endsAt })]
    );
    await client.query('COMMIT');
    res.json({ message: `Account ${action} action recorded.` });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

export default router;
