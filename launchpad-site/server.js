'use strict';
/* ============================================================================
   LaunchPad.dev — one small server: serves the website AND stores everything in MySQL.
   Start it with:  npm start     then open  http://localhost:3000
   ============================================================================ */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

/* ---------------------------------------------------------------- settings */
const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const PORT = Number(env('PORT', '3000'));
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
const SITE_URL = env('SITE_URL', env('RENDER_EXTERNAL_URL', 'http://localhost:' + PORT)).replace(/\/+$/, '');
// Hosted MySQL (TiDB Cloud, Aiven, Railway...) needs an encrypted connection: set DB_SSL=true.
const DB_SSL = env('DB_SSL', 'false').toLowerCase() === 'true';
const DB_CONN = {
  host: env('DB_HOST', 'localhost'), port: Number(env('DB_PORT', '3306')), user: env('DB_USER', 'root'), password: env('DB_PASSWORD', ''),
  ...(DB_SSL ? { ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: env('DB_SSL_INSECURE', 'false').toLowerCase() !== 'true', ...(env('DB_SSL_CA') ? { ca: env('DB_SSL_CA').replace(/\\n/g, '\n') } : {}) } } : {}),
};
const DB_NAME = env('DB_NAME', 'launchpad_site');
const GMAIL_USER = env('GMAIL_USER');
const GMAIL_APP_PASSWORD = env('GMAIL_APP_PASSWORD').replace(/\s+/g, ''); // Google shows it with spaces; they are not part of it
const PAYSTACK_KEY = env('PAYSTACK_SECRET_KEY');
const PAYSTACK_CURRENCY = env('PAYSTACK_CURRENCY', 'ZAR').toUpperCase();
// Email: Brevo (HTTPS API, works on Render's free plan) > Gmail SMTP (works on your own PC) > terminal only.
const BREVO_API_KEY = env('BREVO_API_KEY');
const MAIL_FROM_NAME = env('MAIL_FROM_NAME', 'LaunchPad.dev');
// Admins: comma-separated emails. Whoever signs up with one of these gets the Admin panel.
const ADMIN_EMAILS = env('ADMIN_EMAILS').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const DEMO_PAYMENTS = env('DEMO_PAYMENTS', 'false').toLowerCase() === 'true';
const APP_SECRET = env('APP_SECRET') || crypto.randomBytes(32).toString('hex');
const MAIL_FROM_EMAIL = env('MAIL_FROM_EMAIL', GMAIL_USER);
const isAdmin = (u) => !!u && ADMIN_EMAILS.includes(String(u.email).toLowerCase());

// Microsoft / Outlook sign-in (Microsoft Entra ID). Leave the CLIENT_ID / SECRET blank and the button simply reports "not set up".
const MS_CLIENT_ID = env('MICROSOFT_CLIENT_ID');
const MS_CLIENT_SECRET = env('MICROSOFT_CLIENT_SECRET');
const MS_TENANT = env('MICROSOFT_TENANT', 'common');
const MS_REDIRECT_URI = env('MICROSOFT_REDIRECT_URI', SITE_URL + '/api/auth/microsoft/callback');
const MS_CONFIGURED = !!(MS_CLIENT_ID && MS_CLIENT_SECRET && /^[A-Za-z0-9.-]+$/.test(MS_TENANT));

const PRICES = { monthly: 16900, annual: 169000 }; // in cents: R169 / R1690. Set here, never trusted from the browser.
const CODE_MINUTES = 15, MAX_ATTEMPTS = 5, COOLDOWN_SECONDS = 30, SESSION_DAYS = 7;
const CODE_TABLES = { verify: 'email_verifications', reset: 'password_resets' }; // fixed list, safe to put in SQL

if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) { console.error('DB_NAME can only contain letters, numbers and underscores.'); process.exit(1); }

let pool;

/* ---------------------------------------------------------------- database */
async function initDb() {
  try {
    const boot = await mysql.createConnection(DB_CONN);
    try { await boot.query('CREATE DATABASE IF NOT EXISTS `' + DB_NAME + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); }
    catch (e) { console.warn('Could not run CREATE DATABASE (' + e.code + ') - assuming "' + DB_NAME + '" already exists on your hosted MySQL.'); }
    await boot.end();
  } catch (e) { throw e; }
  pool = mysql.createPool({ ...DB_CONN, database: DB_NAME, waitForConnections: true, connectionLimit: 10 });

  const sql = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await pool.query(stmt);
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) await pool.query('INSERT IGNORE INTO site_settings (setting_key, setting_value) VALUES (?, ?)', [k, v]);
}

// Contact details live in MySQL so an admin can change them from the website. These are only the first-run defaults.
const DEFAULT_SETTINGS = {
  contact_email: env('CONTACT_EMAIL', 'hello@launchpad.dev'),
  contact_phone: env('CONTACT_PHONE', '+27 21 000 0000'),
  contact_hours: env('CONTACT_HOURS', 'Weekdays, 09:00-17:00 SAST.'),
  contact_location: env('CONTACT_LOCATION', 'Cape Town, South Africa'),
  social_linkedin: '', social_github: '', social_instagram: '',
};
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

/* ---------------------------------------------------------------- helpers */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanEmail = (v) => String(v == null ? '' : v).trim().toLowerCase();
const validEmail = (e) => EMAIL_RE.test(e) && e.length <= 254;
const cleanCode = (v) => String(v == null ? '' : v).replace(/\D/g, '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, isAdmin: isAdmin(u) });
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // makes "unknown email" take as long as "wrong password"

/* ---------------------------------------------------------------- email */
const mailer = GMAIL_USER && GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
  : null;
const MAIL_MODE = BREVO_API_KEY && MAIL_FROM_EMAIL ? 'brevo' : mailer ? 'gmail' : 'terminal';

async function sendMail({ to, subject, text, html }) {
  if (MAIL_MODE === 'brevo') {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: MAIL_FROM_NAME, email: MAIL_FROM_EMAIL }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
    });
    if (!r.ok) throw new Error('Brevo ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 300));
    return;
  }
  if (MAIL_MODE === 'gmail') { await mailer.sendMail({ from: MAIL_FROM_NAME + ' <' + GMAIL_USER + '>', to, subject, text, html }); return; }
  throw new Error('No email provider is configured (set BREVO_API_KEY and MAIL_FROM_EMAIL).');
}

async function sendCode(kind, to, name, code) {
  const reset = kind === 'reset';
  const subject = code + (reset ? ' is your LaunchPad.dev password reset code' : ' is your LaunchPad.dev verification code');
  const intro = reset ? 'use this code to reset your LaunchPad.dev password' : 'use this code to finish creating your LaunchPad.dev account';
  if (MAIL_MODE === 'terminal' && !IS_PROD) {
    console.log('\n[TEST MODE - no email provider set up, so nothing was emailed]  ' + kind + ' code for ' + to + ':  ' + code + '\n');
    return;
  }
  await sendMail({
    to, subject,
    text: 'Hi ' + name + ', ' + intro + ': ' + code + '. It expires in ' + CODE_MINUTES + " minutes. If this wasn't you, ignore this email.",
    html: '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto"><h2 style="color:#5b3fd0">' + (reset ? 'Reset your password' : 'Verify your email') + '</h2>' +
      '<p>Hi ' + esc(name) + ', ' + intro + ':</p><p style="font-size:34px;letter-spacing:8px;font-weight:700">' + code + '</p>' +
      "<p style=\"color:#666\">It expires in " + CODE_MINUTES + " minutes. If this wasn't you, ignore this email.</p></div>",
  });
}

/* ---------------------------------------------------------------- one-time codes */
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const codeHash = (code, userId) => sha256(code + ':' + userId + ':' + APP_SECRET);

async function cooling(table, userId) {
  const [rows] = await pool.query('SELECT 1 FROM ' + table + ' WHERE user_id = ? AND last_sent_at > DATE_SUB(NOW(), INTERVAL ' + COOLDOWN_SECONDS + ' SECOND)', [userId]);
  return rows.length > 0;
}

// Creates a fresh code, saves only its hash, emails it. If the email fails the cooldown is lifted so they can retry at once.
async function deliver(kind, userId, email, name) {
  const table = CODE_TABLES[kind];
  const code = newCode();
  await pool.query(
    'INSERT INTO ' + table + ' (user_id, code_hash, expires_at, attempts, last_sent_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ' + CODE_MINUTES + ' MINUTE), 0, NOW()) ' +
    'ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), attempts = 0, last_sent_at = NOW()',
    [userId, codeHash(code, userId)]);
  try {
    await sendCode(kind, email, name, code);
  } catch (e) {
    console.error('\n[EMAIL FAILED via ' + MAIL_MODE + '] ' + e.message + '\nBrevo: check BREVO_API_KEY and that MAIL_FROM_EMAIL is a verified sender in Brevo. Gmail: use an App Password. Gmail SMTP does not work on Render free.\n');
    await pool.query('UPDATE ' + table + ' SET last_sent_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = ?', [userId]);
    const err = new Error('mail'); err.mail = true; throw err;
  }
}

// Every guess is counted BEFORE it is checked (atomically), so the 5-try limit cannot be dodged.
async function checkCode(kind, userId, code) {
  const table = CODE_TABLES[kind];
  const [upd] = await pool.query('UPDATE ' + table + ' SET attempts = attempts + 1 WHERE user_id = ? AND attempts < ?', [userId, MAX_ATTEMPTS]);
  if (upd.affectedRows === 0) {
    const [rows] = await pool.query('SELECT 1 FROM ' + table + ' WHERE user_id = ?', [userId]);
    return rows.length ? 'locked' : 'wrong';
  }
  const [rows] = await pool.query('SELECT code_hash, (expires_at > NOW()) AS valid FROM ' + table + ' WHERE user_id = ?', [userId]);
  const row = rows[0];
  if (!row || !row.valid) return 'wrong';
  const a = Buffer.from(row.code_hash), b = Buffer.from(codeHash(code, userId));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'wrong';
}

/* ---------------------------------------------------------------- sessions */
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ' + SESSION_DAYS + ' DAY))', [sha256(token), userId]);
  return token;
}
async function authUser(req) {
  const m = /^Bearer ([a-f0-9]{64})$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const [rows] = await pool.query(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.email_verified = 1', [sha256(m[1])]);
  if (!rows[0]) return null;
  req.tokenHash = sha256(m[1]);
  return rows[0];
}

/* ---------------------------------------------------------------- app plumbing */
const app = express();
if (env('TRUST_PROXY') || IS_PROD) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use('/api/mentors/me', express.json({ limit: '400kb' })); // a profile photo travels with the profile
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60000).unref();
  return (req, res, next) => {
    const now = Date.now();
    let e = hits.get(req.ip);
    if (!e || e.reset < now) { e = { count: 0, reset: now + windowMs }; hits.set(req.ip, e); }
    if (++e.count > max) return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    next();
  };
}
const authLimiter = limiter(60, 15 * 60 * 1000);
const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });

// Wraps a handler: optional sign-in check + one place that turns crashes into a clean JSON error.
const route = (fn, opts = {}) => async (req, res) => {
  try {
    if (opts.auth) {
      const user = await authUser(req);
      if (!user) return bad(res, 'Please sign in again.', 401);
      req.user = user;
      if (opts.admin && !isAdmin(user)) return bad(res, 'Admins only.', 403);
    }
    await fn(req, res);
  } catch (e) {
    if (e && e.mail) return bad(res, 'We could not send the email right now. Please try again in a moment.', 502);
    console.error(e);
    if (!res.headersSent) bad(res, 'Something went wrong on the server. Please try again.', 500);
  }
};

/* ---------------------------------------------------------------- AUTH */
// Step 1 of sign-up: create an UNVERIFIED account and email a 6-digit code.
app.post('/api/auth/signup', authLimiter, route(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const name = String(req.body.name == null ? '' : req.body.name).trim();
  const password = String(req.body.password == null ? '' : req.body.password);
  const role = req.body.role === 'mentor' ? 'mentor' : 'student';
  const mentorRole = String(req.body.mentorRole == null ? '' : req.body.mentorRole).trim().slice(0, 100);
  const mentorLocation = String(req.body.mentorLocation == null ? '' : req.body.mentorLocation).trim().slice(0, 100);
  if (!validEmail(email)) return bad(res, 'Enter a valid email address.');
  if (name.length < 3 || name.length > 50) return bad(res, 'Username must be 3 to 50 characters.');
  if (password.length < 8 || Buffer.byteLength(password) > 72) return bad(res, 'Password must be 8 to 72 characters.');

  const [rows] = await pool.query('SELECT id, email_verified FROM users WHERE email = ?', [email]);
  let user = rows[0];
  if (user && user.email_verified) return bad(res, 'An account with that email already exists. Try signing in.', 409);

  const hash = await bcrypt.hash(password, 10);
  if (!user) {
    try {
      const [r] = await pool.query('INSERT INTO users (name, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, 0)', [name, email, hash, role]);
      user = { id: r.insertId };
      await pool.query("INSERT INTO subscriptions (user_id, plan, billing) VALUES (?, 'free', 'monthly')", [user.id]);
      if (role === 'mentor') await ensureMentor(user.id, name, mentorRole, mentorLocation);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return bad(res, 'An account with that email already exists. Try signing in.', 409);
      throw e;
    }
  } else {
    // Same person retrying before verifying: refresh their details (only the inbox owner can finish verifying).
    if (await cooling('email_verifications', user.id)) return bad(res, 'Please wait a moment before requesting another code.', 429);
    await pool.query('UPDATE users SET name = ?, password_hash = ?, role = ? WHERE id = ?', [name, hash, role, user.id]);
    if (role === 'mentor') await ensureMentor(user.id, name, mentorRole, mentorLocation);
    else await pool.query('DELETE FROM mentors WHERE user_id = ?', [user.id]);
  }
  await deliver('verify', user.id, email, name);
  res.json({ ok: true });
}));

app.post('/api/auth/resend', authLimiter, route(async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!validEmail(email)) return bad(res, 'Enter a valid email address.');
  const [rows] = await pool.query('SELECT id, name FROM users WHERE email = ? AND email_verified = 0', [email]);
  if (!rows[0]) return res.json({ ok: true }); // don't reveal whether an account exists
  if (await cooling('email_verifications', rows[0].id)) return bad(res, 'Please wait a moment before requesting another code.', 429);
  await deliver('verify', rows[0].id, email, rows[0].name);
  res.json({ ok: true });
}));

// Step 2: the code proves they own the inbox; only then do they get a session.
app.post('/api/auth/verify', authLimiter, route(async (req, res) => {
  const email = cleanEmail(req.body.email), code = cleanCode(req.body.code);
  const WRONG = 'That code is wrong or has expired.';
  if (!validEmail(email) || code.length !== 6) return bad(res, WRONG);
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  if (!user) return bad(res, WRONG);
  const result = await checkCode('verify', user.id, code);
  if (result === 'locked') return bad(res, 'Too many attempts. Request a new code.', 429);
  if (result !== 'ok') return bad(res, WRONG);
  await pool.query('UPDATE users SET email_verified = 1 WHERE id = ?', [user.id]);
  await pool.query('DELETE FROM email_verifications WHERE user_id = ?', [user.id]);
  user.email_verified = 1;
  res.json({ token: await createSession(user.id), user: publicUser(user) });
}));

app.post('/api/auth/login', authLimiter, route(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password == null ? '' : req.body.password);
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  const ok = password.length <= 200 && await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) return bad(res, 'Invalid email or password.', 401);
  if (!user.email_verified) return bad(res, 'email_not_verified', 403);
  res.json({ token: await createSession(user.id), user: publicUser(user) });
}));

app.post('/api/auth/logout', route(async (req, res) => {
  await authUser(req);
  if (req.tokenHash) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [req.tokenHash]);
  res.json({ ok: true });
}));

app.get('/api/auth/me', route(async (req, res) => { res.json({ user: publicUser(req.user) }); }, { auth: true }));

// Forgot password: emails a code (always answers "ok" so nobody can test which emails have accounts).
app.post('/api/auth/forgot', authLimiter, route(async (req, res) => {
  const email = cleanEmail(req.body.email);
  if (!validEmail(email)) return bad(res, 'Enter a valid email address.');
  const [rows] = await pool.query('SELECT id, name FROM users WHERE email = ?', [email]);
  if (rows[0] && !(await cooling('password_resets', rows[0].id))) await deliver('reset', rows[0].id, email, rows[0].name);
  res.json({ ok: true });
}));

app.post('/api/auth/reset', authLimiter, route(async (req, res) => {
  const email = cleanEmail(req.body.email), code = cleanCode(req.body.code);
  const password = String(req.body.password == null ? '' : req.body.password);
  const WRONG = 'That code is wrong or has expired.';
  if (password.length < 8 || Buffer.byteLength(password) > 72) return bad(res, 'Password must be 8 to 72 characters.');
  if (!validEmail(email) || code.length !== 6) return bad(res, WRONG);
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (!rows[0]) return bad(res, WRONG);
  const result = await checkCode('reset', rows[0].id, code);
  if (result === 'locked') return bad(res, 'Too many attempts. Request a new code.', 429);
  if (result !== 'ok') return bad(res, WRONG);
  await pool.query('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?', [await bcrypt.hash(password, 10), rows[0].id]);
  await pool.query('DELETE FROM password_resets WHERE user_id = ?', [rows[0].id]);
  await pool.query('DELETE FROM sessions WHERE user_id = ?', [rows[0].id]); // sign out everywhere
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- MICROSOFT / OUTLOOK SIGN-IN
   Authorization-code flow (with PKCE + a signed `state`), done entirely on the server:
     /api/auth/microsoft           -> sends the browser to Microsoft
     /api/auth/microsoft/callback  -> Microsoft sends it back here; we swap the code for a token,
                                      ask Microsoft Graph who it is, then find-or-create the LaunchPad user
     /api/auth/microsoft/exchange  -> the page trades a one-time code for the normal LaunchPad session
   The Microsoft client secret and access token never reach the browser or a URL. Users and sessions are the
   existing MySQL `users` / `sessions` tables; nothing new is stored. */
const MS_COOKIE = 'lp_ms_oauth', MS_STATE_MINUTES = 10, MS_HANDOFF_SECONDS = 60;
const MS_SCOPE = 'openid profile email User.Read';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (s) => crypto.createHmac('sha256', APP_SECRET).update(s).digest('base64url');
// Its own rate-limit bucket (a Microsoft sign-in is 3 requests), so it can never use up the allowance of the existing login routes.
const msLimiter = limiter(150, 15 * 60 * 1000);
const handoffs = new Map(); // one-time code -> { token, user, expires }. Lives only ~60 s, in memory, single use.
setInterval(() => { const now = Date.now(); for (const [k, v] of handoffs) if (v.expires < now) handoffs.delete(k); }, 30000).unref();

const msCookieAttrs = () => 'Path=/api/auth/microsoft; HttpOnly; SameSite=Lax' + (SITE_URL.startsWith('https://') ? '; Secure' : '');
function msSetCookie(res, value, maxAge) { res.append('Set-Cookie', MS_COOKIE + '=' + value + '; Max-Age=' + maxAge + '; ' + msCookieAttrs()); }
function msReadCookie(req) {
  const m = new RegExp('(?:^|;\\s*)' + MS_COOKIE + '=([^;]+)').exec(req.headers.cookie || '');
  return m ? m[1] : '';
}
// Sends the browser back to the site with only a fixed error keyword (never Microsoft's own text).
function msFail(res, reason) { res.redirect(302, SITE_URL + '/?ms_error=' + encodeURIComponent(reason)); }

function msDisplayName(profile, email) {
  const n = String(profile.displayName || '').trim().slice(0, 50);
  return n || email.split('@')[0].slice(0, 50);
}

// Finds the existing LaunchPad user by email (no duplicates) or creates one using the existing schema.
async function msFindOrCreateUser(email, profile) {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  let user = rows[0];
  if (user) {
    if (!user.email_verified) {
      // Microsoft has proven they own this inbox. Any password set while it was unverified is thrown away, so
      // whoever typed it in before can't use it now; the owner can choose one with "Forgot password".
      const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      await pool.query('UPDATE users SET email_verified = 1, password_hash = ? WHERE id = ?', [unusable, user.id]);
      await pool.query('DELETE FROM email_verifications WHERE user_id = ?', [user.id]);
      user.email_verified = 1;
    }
    return user;
  }
  // No password exists for a Microsoft-only account, so store a hash of a random secret nobody knows.
  const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  try {
    const [r] = await pool.query('INSERT INTO users (name, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, 1)', [msDisplayName(profile, email), email, unusable, 'student']);
    await pool.query("INSERT INTO subscriptions (user_id, plan, billing) VALUES (?, 'free', 'monthly')", [r.insertId]);
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e; // someone created it a split second ago: just use that one
  }
  const [again] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  return again[0];
}

app.get('/api/auth/microsoft', msLimiter, (req, res) => {
  if (!MS_CONFIGURED) return msFail(res, 'not_configured');
  const state = b64u(crypto.randomBytes(24));
  const verifier = b64u(crypto.randomBytes(32));
  const payload = b64u(JSON.stringify({ s: state, v: verifier, e: Date.now() + MS_STATE_MINUTES * 60000 }));
  msSetCookie(res, payload + '.' + hmac(payload), MS_STATE_MINUTES * 60); // ties this sign-in attempt to THIS browser
  const q = new URLSearchParams({
    client_id: MS_CLIENT_ID, response_type: 'code', redirect_uri: MS_REDIRECT_URI, response_mode: 'query',
    scope: MS_SCOPE, state, prompt: 'select_account',
    code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  });
  res.redirect(302, 'https://login.microsoftonline.com/' + MS_TENANT + '/oauth2/v2.0/authorize?' + q);
});

app.get('/api/auth/microsoft/callback', msLimiter, async (req, res) => {
  try {
    if (!MS_CONFIGURED) return msFail(res, 'not_configured');
    const cookie = msReadCookie(req);
    msSetCookie(res, '', 0); // an attempt can only be finished once
    if (req.query.error) return msFail(res, req.query.error === 'access_denied' ? 'cancelled' : 'microsoft_error');

    // --- validate state: signed by us, not expired, made by this browser, and equal to what came back
    const [payload, sig] = cookie.split('.');
    let saved = null;
    if (payload && sig) {
      const want = Buffer.from(hmac(payload)), got = Buffer.from(sig);
      if (want.length === got.length && crypto.timingSafeEqual(want, got)) { try { saved = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch (e) { saved = null; } }
    }
    const state = String(req.query.state || '');
    const sa = Buffer.from(saved ? String(saved.s) : ''), sb = Buffer.from(state);
    if (!saved || sa.length === 0 || sa.length !== sb.length || !crypto.timingSafeEqual(sa, sb)) return msFail(res, 'invalid_state');
    if (!(saved.e > Date.now())) return msFail(res, 'expired_state');
    const code = String(req.query.code || '');
    if (!code) return msFail(res, 'no_code');

    // --- code -> token (the client secret only ever travels server -> Microsoft)
    const tr = await fetch('https://login.microsoftonline.com/' + MS_TENANT + '/oauth2/v2.0/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: MS_REDIRECT_URI, code_verifier: saved.v, scope: MS_SCOPE }),
    });
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) { console.error('[Microsoft] token exchange failed: ' + (tok.error || tr.status)); return msFail(res, 'token_failed'); }

    // --- who is this? (Microsoft Graph, the minimum fields)
    const gr = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', { headers: { Authorization: 'Bearer ' + tok.access_token } });
    const profile = await gr.json().catch(() => ({}));
    if (!gr.ok || !profile.id) { console.error('[Microsoft] Graph lookup failed: ' + gr.status); return msFail(res, 'graph_failed'); }

    let email = cleanEmail(profile.mail);
    if (!email) { const upn = cleanEmail(profile.userPrincipalName); if (!upn.includes('#ext#')) email = upn; } // guest-style UPNs aren't real inboxes
    if (!email) return msFail(res, 'no_email');
    if (!validEmail(email)) return msFail(res, 'invalid_email');

    // --- Microsoft identity -> existing LaunchPad user + existing session
    const user = await msFindOrCreateUser(email, profile);
    if (!user) return msFail(res, 'server_error');
    const handoff = b64u(crypto.randomBytes(32));
    handoffs.set(handoff, { token: await createSession(user.id), user: publicUser(user), expires: Date.now() + MS_HANDOFF_SECONDS * 1000 });
    res.redirect(302, SITE_URL + '/#ms_code=' + handoff); // fragment: never sent to any server or logged
  } catch (e) {
    console.error('[Microsoft] sign-in error:', e && e.message);
    if (!res.headersSent) msFail(res, 'server_error');
  }
});

app.post('/api/auth/microsoft/exchange', msLimiter, route(async (req, res) => {
  const code = String(req.body.code || '');
  const h = handoffs.get(code);
  handoffs.delete(code); // single use
  if (!h || h.expires < Date.now()) return bad(res, 'That Microsoft sign-in link has expired. Please try again.', 400);
  res.json({ token: h.token, user: h.user });
}));

/* ---------------------------------------------------------------- SUBSCRIPTION + PAYMENT */
app.get('/api/subscription', route(async (req, res) => {
  await pool.query("UPDATE subscriptions SET plan = 'free', current_period_end = NULL WHERE user_id = ? AND plan = 'pro' AND current_period_end IS NOT NULL AND current_period_end < NOW()", [req.user.id]);
  const [rows] = await pool.query('SELECT plan, billing, current_period_end FROM subscriptions WHERE user_id = ?', [req.user.id]);
  res.json(rows[0] || { plan: 'free', billing: 'monthly', current_period_end: null });
}, { auth: true }));

app.post('/api/subscription/cancel', route(async (req, res) => {
  await pool.query("UPDATE subscriptions SET plan = 'free', current_period_end = NULL WHERE user_id = ?", [req.user.id]);
  res.json({ ok: true });
}, { auth: true }));

app.post('/api/pay/checkout', route(async (req, res) => {
  const billing = req.body.billing;
  if (!PRICES[billing]) return bad(res, 'Unknown billing period.');
  if (!PAYSTACK_KEY && !DEMO_PAYMENTS) return bad(res, 'Payments are not switched on yet. The site owner needs to add a Paystack key.', 503);
  const reference = 'lp_' + req.user.id + '_' + crypto.randomBytes(8).toString('hex');
  await pool.query('INSERT INTO payments (reference, user_id, billing, amount) VALUES (?, ?, ?, ?)', [reference, req.user.id, billing, PRICES[billing]]);
  if (!PAYSTACK_KEY) return res.json({ url: SITE_URL + '/?reference=' + reference, reference }); // demo mode
  const r = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + PAYSTACK_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: req.user.email, amount: PRICES[billing], currency: PAYSTACK_CURRENCY, reference, callback_url: SITE_URL + '/', channels: ['card'], metadata: { user_id: req.user.id, billing } }),
  });
  const out = await r.json().catch(() => ({}));
  if (!out.status) {
    console.error('[Paystack] initialize failed (' + r.status + '): ' + (out.message || 'no message') + '  <- if this mentions currency, set PAYSTACK_CURRENCY to your account currency');
    await pool.query('DELETE FROM payments WHERE reference = ?', [reference]);
    return bad(res, 'Paystack could not start the payment: ' + (out.message || 'unknown error'), 502);
  }
  res.json({ url: out.data.authorization_url, reference });
}, { auth: true }));

// Pro is only granted after Paystack itself confirms the money arrived (or in demo mode).
app.post('/api/pay/confirm', route(async (req, res) => {
  const reference = String(req.body.reference || '');
  const [rows] = await pool.query('SELECT billing, amount, status FROM payments WHERE reference = ? AND user_id = ?', [reference, req.user.id]);
  const pay = rows[0];
  if (!pay) return res.json({ ok: false });
  if (pay.status !== 'paid') {
    if (PAYSTACK_KEY) {
      const r = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), { headers: { Authorization: 'Bearer ' + PAYSTACK_KEY } });
      const out = await r.json();
      const d = out.data || {};
      if (!out.status || d.status !== 'success' || d.currency !== PAYSTACK_CURRENCY || d.reference !== reference || d.amount < pay.amount) return res.json({ ok: false });
    } else if (!DEMO_PAYMENTS) {
      return res.json({ ok: false });
    }
    await pool.query("UPDATE payments SET status = 'paid', paid_at = NOW() WHERE reference = ? AND status = 'pending'", [reference]);
    await pool.query(
      "UPDATE subscriptions SET plan = 'pro', billing = ?, current_period_end = DATE_ADD(NOW(), INTERVAL " + (pay.billing === 'annual' ? '1 YEAR' : '1 MONTH') + ') WHERE user_id = ?',
      [pay.billing, req.user.id]);
  }
  res.json({ ok: true, billing: pay.billing });
}, { auth: true }));

/* ---------------------------------------------------------------- MENTORS (MySQL table `mentors`) */
const parseList = (v) => { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const mentorOut = (m, withContact) => ({
  id: 'db' + m.id, name: m.name, role: m.role_title || '', location: m.location || '', about: m.about || '',
  skills: parseList(m.skills), experience: parseList(m.experience), photo: m.photo || null,
  ...(withContact ? { contactEmail: m.contact_email || '', contactPhone: m.contact_phone || '', linkedin: m.linkedin || '' } : {}),
});
async function ensureMentor(userId, name, roleTitle, location) {
  await pool.query(
    `INSERT INTO mentors (user_id, name, role_title, location) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name),
       role_title = IF(VALUES(role_title) <> '', VALUES(role_title), role_title),
       location = IF(VALUES(location) <> '', VALUES(location), location)`,
    [userId, name, roleTitle || '', location || '']);
}

// Public list of verified mentors. Contact details are only included for signed-in visitors.
app.get('/api/mentors', route(async (req, res) => {
  const viewer = await authUser(req);
  const [rows] = await pool.query("SELECT m.* FROM mentors m JOIN users u ON u.id = m.user_id WHERE u.email_verified = 1 AND m.role_title <> '' ORDER BY m.created_at DESC LIMIT 500");
  res.json({ mentors: rows.map((m) => mentorOut(m, !!viewer)) });
}));

app.get('/api/mentors/me', route(async (req, res) => {
  if (req.user.role !== 'mentor') return bad(res, 'Not a mentor account.', 403);
  await ensureMentor(req.user.id, req.user.name, '', '');
  const [rows] = await pool.query('SELECT * FROM mentors WHERE user_id = ?', [req.user.id]);
  res.json({ mentor: mentorOut(rows[0], true) });
}, { auth: true }));

app.put('/api/mentors/me', route(async (req, res) => {
  if (req.user.role !== 'mentor') return bad(res, 'Not a mentor account.', 403);
  const b = req.body || {};
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const name = str(b.name, 50);
  if (name.length < 3) return bad(res, 'Name must be 3 to 50 characters.');
  const contactEmail = str(b.contactEmail, 254);
  if (contactEmail && !validEmail(contactEmail.toLowerCase())) return bad(res, 'Enter a valid contact email.');
  const skills = (Array.isArray(b.skills) ? b.skills : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 30);
  const experience = (Array.isArray(b.experience) ? b.experience : []).slice(0, 20)
    .map((x) => ({ role: str(x && x.role, 100), company: str(x && x.company, 100), dates: str(x && x.dates, 60) })).filter((x) => x.role || x.company);
  let photo = null;
  if (b.photo) {
    if (typeof b.photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo) || b.photo.length > 300000) return bad(res, 'That photo is not valid or is too large.');
    photo = b.photo;
  }
  await ensureMentor(req.user.id, name, '', '');
  await pool.query(
    'UPDATE mentors SET name = ?, role_title = ?, location = ?, about = ?, skills = ?, experience = ?, contact_email = ?, contact_phone = ?, linkedin = ?, photo = ? WHERE user_id = ?',
    [name, str(b.role, 100), str(b.location, 100), str(b.about, 2000), JSON.stringify(skills), JSON.stringify(experience), contactEmail, str(b.contactPhone, 40), str(b.linkedin, 255), photo, req.user.id]);
  await pool.query('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);
  res.json({ ok: true });
}, { auth: true }));

app.delete('/api/account', route(async (req, res) => {
  await pool.query('DELETE FROM users WHERE id = ?', [req.user.id]); // sessions, mentor profile, subscription, payments go with it
  res.json({ ok: true });
}, { auth: true }));

/* ---------------------------------------------------------------- CONTACT DETAILS + CONTACT FORM */
async function readSettings() {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM site_settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (SETTING_KEYS.includes(r.setting_key)) out[r.setting_key] = r.setting_value;
  return out;
}
app.get('/api/settings', route(async (req, res) => { res.json(await readSettings()); }));

const contactLimiter = limiter(10, 15 * 60 * 1000);
app.post('/api/contact', contactLimiter, route(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  const email = cleanEmail(req.body.email);
  const message = String(req.body.message || '').trim().slice(0, 3000);
  if (!name || !validEmail(email) || !message) return bad(res, 'Please fill in your name, a valid email, and a message.');
  await pool.query('INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)', [name, email, message]);
  if (MAIL_MODE !== 'terminal') { // best effort: tell the team by email too
    readSettings().then((s) => sendMail({
      to: s.contact_email, subject: 'New LaunchPad.dev message from ' + name,
      text: name + ' <' + email + '> wrote:\n\n' + message,
      html: '<p><b>' + esc(name) + '</b> &lt;' + esc(email) + '&gt; wrote:</p><p>' + esc(message).replace(/\n/g, '<br>') + '</p>',
    })).catch((e) => console.error('[contact notify failed] ' + e.message));
  }
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- ADMIN (only emails listed in ADMIN_EMAILS) */
app.get('/api/admin/overview', route(async (req, res) => {
  const count = async (sql) => (await pool.query(sql))[0][0].n;
  res.json({
    users: await count('SELECT COUNT(*) AS n FROM users'),
    verified: await count('SELECT COUNT(*) AS n FROM users WHERE email_verified = 1'),
    mentors: await count("SELECT COUNT(*) AS n FROM mentors m JOIN users u ON u.id = m.user_id WHERE u.email_verified = 1"),
    pro: await count("SELECT COUNT(*) AS n FROM subscriptions WHERE plan = 'pro'"),
    paid: await count("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'paid'"),
    messages: await count('SELECT COUNT(*) AS n FROM contact_messages'),
  });
}, { auth: true, admin: true }));

app.get('/api/admin/users', route(async (req, res) => {
  const [rows] = await pool.query('SELECT u.id, u.name, u.email, u.role, u.email_verified, u.created_at, s.plan FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id ORDER BY u.id DESC LIMIT 500');
  res.json({ users: rows.map((u) => ({ ...u, isAdmin: isAdmin(u) })) });
}, { auth: true, admin: true }));

app.get('/api/admin/mentors', route(async (req, res) => {
  const [rows] = await pool.query('SELECT m.id, m.user_id, m.name, m.role_title, m.location, m.contact_email, m.created_at, u.email, u.email_verified FROM mentors m JOIN users u ON u.id = m.user_id ORDER BY m.id DESC LIMIT 500');
  res.json({ mentors: rows });
}, { auth: true, admin: true }));

app.get('/api/admin/payments', route(async (req, res) => {
  const [rows] = await pool.query('SELECT p.reference, p.billing, p.amount, p.status, p.created_at, p.paid_at, u.email FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 300');
  res.json({ payments: rows });
}, { auth: true, admin: true }));

app.get('/api/admin/messages', route(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, message, created_at FROM contact_messages ORDER BY id DESC LIMIT 300');
  res.json({ messages: rows });
}, { auth: true, admin: true }));

app.delete('/api/admin/messages/:id', route(async (req, res) => {
  await pool.query('DELETE FROM contact_messages WHERE id = ?', [Number(req.params.id) || 0]);
  res.json({ ok: true });
}, { auth: true, admin: true }));

app.delete('/api/admin/users/:id', route(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const [rows] = await pool.query('SELECT email FROM users WHERE id = ?', [id]);
  if (!rows[0]) return bad(res, 'No such user.', 404);
  if (isAdmin(rows[0])) return bad(res, 'Admin accounts cannot be deleted here.', 400);
  await pool.query('DELETE FROM users WHERE id = ?', [id]);
  res.json({ ok: true });
}, { auth: true, admin: true }));

app.put('/api/admin/settings', route(async (req, res) => {
  const b = req.body || {};
  const clean = {};
  for (const k of SETTING_KEYS) {
    if (b[k] === undefined) continue;
    const v = String(b[k]).trim().slice(0, 300);
    if (k === 'contact_email' && !validEmail(v.toLowerCase())) return bad(res, 'Enter a valid contact email.');
    if (k.startsWith('social_') && v && !/^https?:\/\//i.test(v)) return bad(res, 'Social links must start with http:// or https://');
    clean[k] = v;
  }
  for (const [k, v] of Object.entries(clean)) await pool.query('INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [k, v]);
  res.json(await readSettings());
}, { auth: true, admin: true }));

app.get('/healthz', (req, res) => res.json({ ok: true }));

/* ---------------------------------------------------------------- website files + errors */
app.use('/api', (req, res) => bad(res, 'Not found.', 404));
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => { // malformed JSON etc.
  if (res.headersSent) return next(err);
  bad(res, 'Bad request.', 400);
});

/* ---------------------------------------------------------------- start */
(async () => {
  try {
    await initDb();
  } catch (e) {
    console.error('\nCould not start the database connection: ' + (e.code || '') + ' ' + e.message);
    if (e.code === 'ECONNREFUSED') console.error('-> MySQL is not running (or DB_HOST / DB_PORT in .env is wrong). Start MySQL and try again.');
    if (e.code === 'ER_ACCESS_DENIED_ERROR') console.error('-> Wrong MySQL username or password. Fix DB_USER / DB_PASSWORD in your .env file.');
    process.exit(1);
  }
  setInterval(() => pool.query('DELETE FROM sessions WHERE expires_at < NOW()').catch(() => {}), 60 * 60 * 1000).unref();
  app.listen(PORT, () => {
    console.log('\n  LaunchPad.dev is running  ->  ' + SITE_URL);
    console.log('  MySQL database            ->  ' + DB_NAME + ' (tables created automatically)');
    console.log('  Emails                    ->  ' + (MAIL_MODE === 'brevo' ? 'sent with Brevo from ' + MAIL_FROM_EMAIL : MAIL_MODE === 'gmail' ? 'sent from ' + GMAIL_USER + ' (Gmail SMTP)' : IS_PROD ? 'NOT CONFIGURED - sign-up codes cannot be emailed! Set BREVO_API_KEY + MAIL_FROM_EMAIL' : 'TEST MODE: codes are printed here in this window'));
    console.log('  Admins                    ->  ' + (ADMIN_EMAILS.length ? ADMIN_EMAILS.join(', ') : 'none (set ADMIN_EMAILS)'));
    console.log('  Payments                  ->  ' + (PAYSTACK_KEY ? 'Paystack' : DEMO_PAYMENTS ? 'DEMO (no charge)' : 'off') + '\n');
  });
})();
