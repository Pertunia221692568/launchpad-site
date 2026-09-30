# LaunchPad.dev — start here

> **Going live?** Read `DEPLOY.md` first (Render + hosted MySQL + Brevo email + admin panel). This file is for running it on your own computer.

One folder. No Java, no IntelliJ, no Supabase. A small Node.js server runs the website **and** saves
everything (accounts, email codes, logins, subscriptions) in your **MySQL**.

## What you need installed (once)
1. **Node.js** (LTS version) — https://nodejs.org  (this also installs `npm`)
2. **MySQL** running on your computer (the one you already used is fine), and its `root` password.

## Set it up (about 5 minutes)

**1. Open a terminal in this folder** (the one containing `server.js`).
   Windows tip: open the folder in File Explorer, click the address bar, type `cmd`, press Enter.

**2. Create your settings file.**
   Copy `.env.example` and name the copy exactly `.env`  (Windows: `copy .env.example .env`).
   Open `.env` in Notepad and change **only** this line to your real MySQL password:
   ```
   DB_PASSWORD=your_mysql_password_here
   ```

**3. Install and start.**
   ```
   npm install
   npm start
   ```
   You should see `LaunchPad.dev is running -> http://localhost:3000`.
   The server creates the database (`launchpad_site`) and all tables by itself — you run no SQL.

**4. Open http://localhost:3000** in your browser (type this address; do **not** double-click `index.html`).

## Try it
1. Sign Up with an email address.
2. **No Gmail set up yet?** That's fine: the 6-digit code is printed in the terminal window where the server runs. Type it in.
3. You're signed in. Sign out and sign in again to test login.
4. Check MySQL: in MySQL Workbench (or the `mysql` command line) run
   ```sql
   USE launchpad_site;
   SELECT id, name, email, email_verified, created_at FROM users;
   ```
   Your new user is there. (This is a **new** database. The old `launchpad_db` from the Java version is not used.)

## Make it send real emails (Gmail)
1. Google Account → Security → turn on **2-Step Verification**.
2. Same page → search **App passwords** → create one (Google shows 16 letters).
3. In `.env` fill in:
   ```
   GMAIL_USER=yourname@gmail.com
   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
   ```
   (Must be the App Password, **not** your normal Gmail password.)
4. Stop the server (Ctrl+C) and run `npm start` again. The start-up message now says emails are sent from your Gmail.

## What works
- Sign up with a **6-digit email code** (expires after 15 minutes, 5 wrong tries then it locks, 30 s between resends)
- Sign in (refuses accounts that haven't verified their email)
- **Forgot password** by emailed code (this now changes the real password in MySQL)
- Passwords are stored only as bcrypt hashes; login tokens are stored hashed
- Pro subscription: shows/cancels from MySQL. Payments: with no Paystack key and `DEMO_PAYMENTS=true` the Pay button
  grants Pro **without charging** (fine for a class demo). Put a `PAYSTACK_SECRET_KEY` in `.env` for real payments.
- **Continue with Outlook** (Microsoft sign-in) on the Sign In and Sign Up pages. It needs the one-time Microsoft setup below; until then the button just says it is not set up.

## Turn on "Continue with Outlook" (Microsoft sign-in)
Everything in the code is already done. You only need to register the site with Microsoft once (free):
1. Open the Microsoft Entra admin center (https://entra.microsoft.com) -> **App registrations** -> **New registration**.
2. **Supported account types:** "Accounts in any organizational directory and personal Microsoft accounts".
3. **Redirect URI:** platform **Web**, value exactly `http://localhost:3000/api/auth/microsoft/callback` (use your port if you changed `PORT`).
4. Click **Register**, then copy the **Application (client) ID** into `MICROSOFT_CLIENT_ID` in `.env`.
5. **Certificates & secrets** -> **New client secret** -> copy the secret **Value** (not the ID) into `MICROSOFT_CLIENT_SECRET` in `.env`.
6. **API permissions** should already list Microsoft Graph -> `User.Read`. Nothing else is needed.
7. Restart the server (`npm start`) and click **Continue with Outlook**.

How it behaves: a Microsoft account whose email already exists in LaunchPad signs into that same account (no duplicate); a new one gets a
new LaunchPad account. Either way the normal LaunchPad session is used, so everything else on the site works as usual.
When you put the site online, add a second Redirect URI `https://YOUR-DOMAIN/api/auth/microsoft/callback` in Entra and set
`SITE_URL` and `MICROSOFT_REDIRECT_URI` to match. Never put the client secret in any file inside `public/`.

## Open it in IntelliJ IDEA
1. **File -> Open...** and choose this `launchpad-site` folder (the one containing `package.json`).
2. Ultimate edition: install/enable the **Node.js** plugin if asked, and set **Settings -> Languages & Frameworks -> Node.js** to your Node interpreter.
   Then run the ready-made configuration **Start LaunchPad** (top-right run box), or open `package.json` and click the green arrow next to `start`.
3. Community edition (no Node plugin): open **View -> Tool Windows -> Terminal** and type `npm start`.
4. Start MySQL first, then open http://localhost:3000. `node_modules` is already included, so `npm install` is only needed if you delete it.

## What is still saved in the browser, not MySQL
Mentors ARE now in MySQL (table `mentors`). Bookings, CV builder drafts, and solved coding challenges still use the browser's storage exactly as
before — the site never saved those to any database. Say the word and I'll move them into MySQL next.

## If something goes wrong
| You see | Fix |
|---|---|
| `ECONNREFUSED` when starting | MySQL isn't running. Start it (Services on Windows / XAMPP control panel). |
| `ER_ACCESS_DENIED_ERROR` | Wrong `DB_PASSWORD` (or `DB_USER`) in `.env`. |
| `npm` / `node` not recognised | Install Node.js, then close and reopen the terminal. |
| Page says "Could not reach the server" | The server isn't running, or you opened `index.html` by double-clicking. Run `npm start`, use http://localhost:3000. |
| `[EMAIL FAILED] ... Invalid login` | Gmail details wrong — it must be an App Password. |
| Email doesn't arrive | Check spam; press "Resend code"; or watch the terminal for the error. |
| Port 3000 already in use | Set `PORT=3001` and `SITE_URL=http://localhost:3001` in `.env`. |

## Putting it online later
GitHub Pages can only host plain files, so it **cannot** run this server. To go public you'd host this folder on
something like Render or Railway and use a hosted MySQL (e.g. Railway MySQL, Aiven). Set `SITE_URL` to your public
address and `TRUST_PROXY=1`. For now, running it on your own computer is the simplest way.

## Folder map
```
server.js        the server + all the auth/email/MySQL logic
database.sql     the table layout (created automatically)
.env             YOUR settings (never share or upload this file)
public/          the website itself (index.html, script.js, style.css, api-client.js)
.run/           IntelliJ "Start LaunchPad" run configuration (optional)
```
Add a line `.env` and `node_modules` to `.gitignore` if you upload this to GitHub.
