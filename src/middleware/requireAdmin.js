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
        'SELECT role FROM admin_roles WHERE user_id = $1',
        [req.session.userId]
      );
      const roles = result.rows.map(row => row.role);
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
