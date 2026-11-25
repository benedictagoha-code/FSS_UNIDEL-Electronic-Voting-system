import { pool } from '../db.js';

export function requireSignedIn(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Sign-in required.' });
  next();
}

export function requireAdmin(allowedRoles = []) {
  return async (req, res, next) => {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sign-in required.' });
    try {
      const result = await pool.query(
        `SELECT ar.role
         FROM admin_roles ar
         JOIN users u ON u.id = ar.user_id
         WHERE ar.user_id = $1 AND u.account_status = 'active'`,
        [req.session.userId]
      );
      const roles = result.rows.map(row => row.role);
      // A previously authenticated administrator must lose privileged access
      // immediately if the account is suspended or deactivated.
      if (!roles.length || (allowedRoles.length && !roles.some(role => allowedRoles.includes(role)))) {
        return res.status(403).json({ error: 'You are not authorised to perform this action.' });
      }
      req.adminRoles = roles;
      next();
    } catch (error) {
      next(error);
    }
  };
}
