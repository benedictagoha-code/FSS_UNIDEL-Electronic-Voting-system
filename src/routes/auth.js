import { Router } from 'express';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { pool } from '../db.js';
import { sendPasswordResetOtp } from '../services/sms.js';

const router = Router();
const phonePattern = /^\+[1-9]\d{7,14}$/;
const matricPattern = /^[A-Z0-9/-]{4,40}$/;
const passwordSchema = z.string().min(10).max(128);

const registerSchema = z.object({
  fullName: z.string().trim().min(3).max(180),
  sex: z.enum(['Female', 'Male']),
  department: z.string().trim().min(2).max(120),
  level: z.enum(['100','200','300','400','500','600']),
  matricType: z.enum(['matriculation','registration']),
  matricNumber: z.string().trim().toUpperCase().regex(matricPattern),
  phoneNumber: z.string().trim().regex(phonePattern, 'Use international format, e.g. +2348012345678.'),
  password: passwordSchema
});

const loginSchema = z.object({
  matricNumber: z.string().trim().toUpperCase().regex(matricPattern),
  password: z.string().min(1).max(128)
});

const resetRequestSchema = z.object({
  matricNumber: z.string().trim().toUpperCase().regex(matricPattern)
});

const resetCompleteSchema = z.object({
  matricNumber: z.string().trim().toUpperCase().regex(matricPattern),
  otp: z.string().regex(/^\d{6}$/),
  newPassword: passwordSchema
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });

function otpVerifier(userId, code) {
  const pepper = process.env.OTP_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error('OTP_PEPPER must be at least 32 characters.');
  return crypto.createHmac('sha256', pepper).update(userId + ':' + code).digest('hex');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

router.post('/register', authLimiter, async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please check the registration details.', details: parsed.error.flatten().fieldErrors });

  const data = parsed.data;
  if ((data.level === '100') !== (data.matricType === 'registration')) {
    return res.status(400).json({ error: '100 Level students must use a registration number; other levels must use a matriculation number.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await argon2.hash(data.password, { type: argon2.argon2id });
    const userResult = await client.query(
      `INSERT INTO users (matric_number, phone_e164, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [data.matricNumber, data.phoneNumber, passwordHash]
    );
    const userId = userResult.rows[0].id;
    await client.query(
      `INSERT INTO student_profiles (user_id, full_name, sex, department, level, matric_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, data.fullName, data.sex, data.department, data.level, data.matricType]
    );
    await client.query('COMMIT');
    return res.status(201).json({ message: 'Registration successful. You can now sign in.', user: { fullName: data.fullName, matricNumber: data.matricNumber } });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'That matriculation/registration number or phone number is already registered.' });
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid matriculation/registration number and password.' });
  try {
    const result = await pool.query(
      `SELECT u.id, u.password_hash, u.account_status, p.full_name
       FROM users u JOIN student_profiles p ON p.user_id = u.id
       WHERE u.matric_number = $1`,
      [parsed.data.matricNumber]
    );
    const user = result.rows[0];
    const valid = user && await argon2.verify(user.password_hash, parsed.data.password);
    if (!valid || user.account_status !== 'active') return res.status(401).json({ error: 'Invalid credentials or account unavailable.' });
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    return res.json({ message: 'Sign-in successful.', user: { fullName: user.full_name } });
  } catch (error) { return next(error); }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie('fss.sid');
    return res.json({ message: 'Signed out.' });
  });
});

router.get('/me', async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in.' });
  try {
    const result = await pool.query(
      `SELECT p.full_name, u.matric_number, p.department, p.level, u.account_status
       FROM users u JOIN student_profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [req.session.userId]
    );
    if (!result.rowCount || result.rows[0].account_status !== 'active') return res.status(401).json({ error: 'Account unavailable.' });
    return res.json({ user: result.rows[0] });
  } catch (error) { return next(error); }
});

router.post('/password-reset/request', resetLimiter, async (req, res, next) => {
  const parsed = resetRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid matriculation/registration number.' });

  let pendingDelivery = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, phone_e164 FROM users
       WHERE matric_number = $1 AND account_status = 'active'
       FOR UPDATE`,
      [parsed.data.matricNumber]
    );

    // Keep the public response identical for unknown, inactive and rate-limited accounts.
    if (result.rowCount) {
      const user = result.rows[0];
      const recent = await client.query(
        `SELECT COUNT(*)::int AS count FROM password_reset_otps
         WHERE user_id=$1 AND created_at > NOW() - INTERVAL '15 minutes'`,
        [user.id]
      );

      // Limit reset-code generation per account as well as per source IP.
      if (recent.rows[0].count < 3) {
        await client.query(
          `UPDATE password_reset_otps SET consumed_at=NOW()
           WHERE user_id=$1 AND consumed_at IS NULL`,
          [user.id]
        );
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const verifier = otpVerifier(user.id, code);
        const inserted = await client.query(
          `INSERT INTO password_reset_otps (user_id, otp_verifier, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
           RETURNING id`,
          [user.id, verifier]
        );
        pendingDelivery = { id: inserted.rows[0].id, userId: user.id, phone: user.phone_e164, code };
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }

  if (pendingDelivery) {
    try {
      await sendPasswordResetOtp({ to: pendingDelivery.phone, code: pendingDelivery.code });
    } catch (smsError) {
      // Consume the undelivered code so it cannot be used, while retaining
      // its timestamp for per-account request throttling.
      await pool.query(
        'UPDATE password_reset_otps SET consumed_at=NOW() WHERE id=$1 AND user_id=$2',
        [pendingDelivery.id, pendingDelivery.userId]
      );
      console.error('Password-reset SMS delivery unavailable.');
    }
  }

  return res.status(202).json({ message: 'If the account is eligible, a password-reset code will be sent to its registered phone number.' });
});
router.post('/password-reset/complete', resetLimiter, async (req, res, next) => {
  const parsed = resetCompleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the matriculation/registration number, six-digit code and a valid new password.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `SELECT id FROM users WHERE matric_number = $1 AND account_status = 'active' FOR UPDATE`,
      [parsed.data.matricNumber]
    );
    if (!userResult.rowCount) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The code is invalid or has expired.' }); }
    const userId = userResult.rows[0].id;
    const otpResult = await client.query(
      `SELECT id, otp_verifier FROM password_reset_otps
       WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > NOW() AND attempts < 5
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [userId]
    );
    if (!otpResult.rowCount) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'The code is invalid or has expired.' }); }
    const otp = otpResult.rows[0];
    const expected = otpVerifier(userId, parsed.data.otp);
    if (!safeEqualHex(otp.otp_verifier, expected)) {
      await client.query('UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
      await client.query('COMMIT');
      return res.status(400).json({ error: 'The code is invalid or has expired.' });
    }
    const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
    await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, userId]);
    await client.query('UPDATE password_reset_otps SET consumed_at = NOW() WHERE user_id = $1 AND consumed_at IS NULL', [userId]);
    await client.query('COMMIT');
    return res.json({ message: 'Password reset successful. You can now sign in with your new password.' });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally { client.release(); }
});

export default router;
