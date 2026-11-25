import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import nominationRoutes from './routes/nominations.js';
import votingRoutes from './routes/voting.js';

const app = express();
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '../public');
const PgSession = connectPgSimple(session);

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') {
  // The application is expected to run behind one trusted TLS-terminating proxy.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
}
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"] } } }));
app.use(express.json({ limit: '20kb' }));
app.use(express.static(publicDir, { index: 'index.html', extensions: ['html'] }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
// Reject cross-origin browser state changes. Non-browser clients without an
// Origin header remain supported; browser form/fetch submissions carry Origin.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const fetchSite = req.get('sec-fetch-site');
  // Fetch Metadata is an additional defence when a browser omits Origin.
  // Reject cross-site and same-site-but-not-same-origin unsafe requests.
  if (!origin) {
    if (fetchSite && fetchSite !== 'same-origin') {
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
    }
    return next();
  }
  try {
    const parsedOrigin = new URL(origin);
    const requestHost = req.get('host');
    const expectedProtocol = req.secure ? 'https:' : 'http:';
    if (parsedOrigin.host !== requestHost || parsedOrigin.protocol !== expectedProtocol) {
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
    }
    return next();
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
});

app.use(session({
  name: 'fss.sid',
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: Number(process.env.SESSION_MAX_AGE_MS || 28800000)
  }
}));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'FSS@UNIDEL Electronic Voting System API' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/nominations', nominationRoutes);
app.use('/api/voting', votingRoutes);

app.use((req, res) => res.status(404).json({ error: 'Route not found.' }));
app.use((error, _req, res, _next) => {
  // Keep internal error details and SQL data out of public responses.
  console.error('Application error:', error.message);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

export default app;
