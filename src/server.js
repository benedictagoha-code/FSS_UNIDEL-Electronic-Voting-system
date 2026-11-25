import 'dotenv/config';
import app from './app.js';

const required = ['DATABASE_URL', 'SESSION_SECRET', 'OTP_PEPPER'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required.`);
}
if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
if (process.env.OTP_PEPPER.length < 32) throw new Error('OTP_PEPPER must be at least 32 characters.');

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`FSS@UNIDEL Voting API listening on port ${port}`);
});
