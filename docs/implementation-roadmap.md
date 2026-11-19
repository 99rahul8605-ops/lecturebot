# V2 parity, validation and cutover roadmap

## Phase 1 — Test foundation (included)
- UI navigation, published content browse, study timer, groups, basic admin.
- Isolated Supabase schema and test Telegram initData verification.

## Phase 2 — Existing bot parity (required)
- Read-only export scripts for SQLite/Mongo; validate 1:1 batch, chapter and lecture mapping.
- Port file-store expiry, channel storage, safe upload + PDF-auto-attach and undo.
- Premium order reconciliation, AdsGram optional rewarded ads, referral ledger migration and flood protection.
- Existing admin powers, force join, settings, announcements, broadcast and user statistics.

## Phase 3 — Full prototype coverage
- Detailed study plans/goals, Pomodoro, study stats and streak algorithms.
- Online study room heartbeat / stale sessions, group owners/admins/invites/reporting/anti-spam.
- Lecture multi-select + notes bulk delivery, bookmarks and viewed history.
- Restyle full admin interface to match supplied 18 screens.

## Phase 4 — Production readiness
- CI tests with database, Telegram integration sandbox, migration rehearsal, performance tests.
- Independent encrypted backups and tested restore procedure.
- Config/secret audit and bot token switch plan, old bot rollback path.

**No production switch until all phases are verified.**
