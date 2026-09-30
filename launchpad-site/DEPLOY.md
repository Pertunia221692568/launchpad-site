# Put LaunchPad.dev online (Render) - do these in order

**Use Render, not Vercel.** Vercel runs short-lived serverless functions; this site is one long-running Node server
with a MySQL connection, which Render runs as-is. Render has no MySQL of its own, so you also need a free hosted MySQL.

## 1. Hosted MySQL (5 min)
Create a free MySQL database at **TiDB Cloud** (Starter) or **Aiven** (free MySQL plan). Check their current free limits.
Copy: host, port, user, password, database name. Use these in step 4 and set `DB_SSL=true`.
(TiDB uses port 4000. Aiven gives its own port and a CA certificate, which goes in `DB_SSL_CA`.)
The tables (users, mentors, sessions, payments, ...) are created automatically the first time the site starts.

## 2. Email that really arrives (10 min) - Brevo
Render's free plan blocks Gmail/SMTP, so codes cannot go out that way. Brevo sends over HTTPS.
1. Sign up at brevo.com (free plan).
2. Senders, Domains & Dedicated IPs > Senders > add the email you want codes to come FROM, click the confirmation link Brevo emails you.
3. SMTP & API > API keys > Generate. Copy the key.
Put the key in `BREVO_API_KEY` and that sender address in `MAIL_FROM_EMAIL`.
Tip: if the sender is a @gmail.com address the first codes can land in spam. Tell your lecturer to check Spam/Junk.

## 3. GitHub
Upload this folder to a GitHub repo. `.env` and `node_modules` are in `.gitignore` - never upload `.env`.

## 4. Render
New + > **Web Service** (or Blueprint using `render.yaml`) > your repo.
Build command `npm install`, start command `npm start`. Then Environment:
`NODE_ENV=production`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL=true`,
`BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `ADMIN_EMAILS=you@example.com`, `APP_SECRET=<long random text>`,
`PAYSTACK_SECRET_KEY` (step 5), `DEMO_PAYMENTS=false`.
Leave `SITE_URL` empty - Render's address is detected automatically.
In the logs you should see `Emails -> sent with Brevo from ...`.

## 5. Payments
Create a Paystack account, copy the **Secret key** (Settings > API Keys; `sk_test_...` is fine for a demo) into `PAYSTACK_SECRET_KEY`.
Test card numbers are in Paystack's docs. `PAYSTACK_CURRENCY` must be a currency your account supports (ZAR for a South African account).
No Paystack key yet and you only need a classroom demo? Set `DEMO_PAYMENTS=true` (the Pay button then grants Pro without charging).

## 6. Admin panel and contact details
Sign up on the live site with the email in `ADMIN_EMAILS`, verify it, then open your avatar menu > **Admin Panel**.
Tabs: Overview, Users, Mentors, Payments, Messages (from the contact form) and **Contact details** (email, phone, location, hours, social links - changes show on the site immediately).

## 7. Before the lecturer tests
- Free Render sites sleep after ~15 min idle: open the site yourself a minute before, the first load is slow.
- Sign up once with a second email of your own as a mentor and as a student, and confirm the codes arrive.
- Check the tables in your hosted MySQL: `SELECT * FROM users;` and `SELECT * FROM mentors;`.
