# EduBot Next — Independent V2 Test Build

**Status:** development/test build, **not** a production-ready replacement of the existing CA Inter bot.

This is a completely new Node.js + Telegram Mini App + managed PostgreSQL project. It is deliberately NOT deployed, NOT connected to the live bot token, and NOT connected to existing production SQLite/MongoDB.

## What's implemented

- Cream + lime / black UI inspired by the supplied 18-screen EduBot prototype.
- Telegram Mini App `initData` HMAC verification on every private API endpoint.
- New PostgreSQL/Supabase schema with row level security enabled; all database access through the Node backend.
- Browse batches → subjects → chapters → lectures, video and PDF notes via Telegram test bot, progress check-off.
- Premium access checked on both the Mini App and Telegram bot delivery.
- Study stopwatch with server timestamps, study session stats and personal to-do checklist.
- Study groups, membership, recent message history and Socket.IO message updates.
- Live count of currently active study sessions (not a full presence system).
- Referrals (join recording), rewards ledger balance and personal share link.
- Basic owner-only content management (draft batches / subjects / chapters / lectures / publish).
- 18 original HTML design screens preserved in `reference-ui/original-18-screen-prototype.html` for visual comparison.

## Not implemented / pending before migration

- **Production parity:** existing SQLite lecture catalogue, old file store, purchases, rewards balances, membership rules, auto-PDF attach, broadcasts, moderation, ads and all older admin tools are **not migrated**. The new system must not replace the old bot yet.
- A safe importer for existing data with row counts, referential checks, old-to-new ID mapping, and payment reconciliation.
- Approved reward-ad integration, advanced study planning/streaks, finished group administration and moderation, chat rate limits, reporting, search and exports.
- End-to-end tests with an actual Supabase test database, Telegram test bot, mobile devices and realistic data.
- Production-quality monitoring, migrations/rollback, backup restore drills, secret rotation and load testing.
- The current basic owner admin forms are functional but not a replacement for the old full admin panel.

## Separate test setup

1. Create a **new, empty GitHub repository** named `EduBot-Next` (do not fork or overwrite `Ca-Inter-lecture-`). This package can be uploaded/pushed there after creation.
2. Create a **new test bot** with BotFather. Never reuse the existing production `BOT_TOKEN` until the final cutover.
3. Create a **new Supabase Cloud test project** (separate from any live database). Open SQL Editor, execute `sql/001_initial.sql`.
4. On a separate test VPS or isolated folder:

```bash
sudo apt update && sudo apt install -y nodejs npm git
node -v  # Node >= 20 required
cp .env.example .env
# edit .env; set BOT_TOKEN, OWNER_ID, WEB_URL (HTTPS test domain), DATABASE_URL
npm install
npm test
npm run check
npm start
```

5. Test `GET /api/health` and open the test web app from the **test bot**. For bot polling, set `BOT_POLLING=true` in test `.env` and restart. Leave the production bot/tunnel unchanged.
6. First admin login uses Telegram `OWNER_ID`; create draft batch → subject → chapter → lecture. For a Telegram file_id, send sample media to test bot in a separate upload tooling workflow; direct upload UI is not yet implemented.

**Important:** Supabase connection strings must only be stored on the VPS in `.env` and never committed to Git. Avoid exposing PostgreSQL to the public network unnecessarily. Managed PostgreSQL usually requires TLS; the Node app validates server certificates.

## Push to the new repo after creating it

```bash
cd edubot-next
git init -b main
git add .
git commit -m "Initial isolated EduBot Next test build"
git remote add origin https://github.com/YOUR_ACCOUNT/EduBot-Next.git
git push -u origin main
```

## Data migration / safe cutover checklist

1. Keep old production bot online untouched. Take verified backups of SQLite, MongoDB and media mappings.
2. Copy data **only to the separate V2 test database**, compare counts, test user access, ownership, premium expiry and referral balances.
3. Test a separate bot token and temporary HTTPS subdomain; do **not** send real users to the test build.
4. Build and verify missing legacy functionality, security checks, chat moderation, download protection and recovery.
5. When all tests pass, schedule an explicit cutover: stop old bot polling, enable production token on V2, change DNS/tunnel and confirm health.
6. Retain encrypted backups and rollback path; don't delete old production data.

## VPS portability

All durable records live in a managed PostgreSQL project independent of the VPS. On a new VPS restore only code, `.env` and HTTPS reverse proxy. File IDs refer to the Telegram bot that uploaded them — switching to a **different bot token** can break file reuse, so preserve old bot identity at final cutover after stopping the old process. Store any future binary assets in external object storage, not the VPS filesystem.

## Architecture

- `src/server.js` Express REST and Socket.IO; Telegram-authenticated APIs.
- `src/bot.js` test Telegram bot commands and protected media delivery.
- `src/auth.js` verified Telegram Mini App login.
- `src/db.js` pooled SSL PostgreSQL connection.
- `public/` cream / lime responsive UI.
- `sql/001_initial.sql` new test schema.
- `tests/` auth verification smoke tests.

### Known limitations of the initial codebase

- Socket.IO only broadcasts to connected instances; horizontal scaling needs a shared adapter/Redis.
- The student timer uses stored server timestamps and survives browser reconnects; sessions abandoned without stop stay active until cleaned up.
- Referral records are created on /start, but reward crediting is intentionally not enabled pending anti-fraud and parity checks.
- Bot must be running with a separate test token and test HTTPS domain; without those the UI shows setup errors rather than fabricated content.
- Review technical and security limits before public access: authentication rate limiting, CORS/CSP, abuse controls and real backups remain to be hardened.
