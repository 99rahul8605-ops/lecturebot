# EduBot update: Study tab, multi-select lectures, new backend

## New files
| File | What it is |
|---|---|
| `models/Study.js` | MongoDB models: profile, subjects, tasks, sessions, groups, group chat |
| `routes/study.js` | Backend for `/api/study/*` (timer, live room, stats, groups, roles, chat) |
| `public/study.js` | Study tab UI: timer, plan (target / subjects / to-do), stats |
| `public/study-social.js` | Groups, Global Room, group timers + chat, admin/co-admin management |
| `public/study.css` | Study tab styles (uses the app's existing theme variables) |
| `public/lecture-picker.js/.css` | Lectures / Notes big buttons + multi-select popup |

## Changed files
* `server.js`: mounts `/api/study`, `studyRoutes.setBot(bot)`, group invite deep link `?start=grp_<CODE>`,
  and shutdown now saves running study timers before exit.
* `routes/course.js`: new `POST /api/lectures/send` (+ bot username cache).
* `public/index.html`: 5th nav tab "Study", `#page-study`, `switchNavTab('study')` hook,
  lecture rows replaced by `_lecPickerHtml(...)` (3 call sites), asset tags.

## How it works
**Multi-send.** The popup posts `{batchId, items:[{lectureId,type}]}` to `/api/lectures/send`.
The server re-checks premium access, resolves each lecture/notes link to its stored Telegram file, packs them
into a temporary bulk batch (`user_id = ms_<id>`, purged after 24h) and returns ONE `t.me/<bot>?start=BS...` link.
The bot's existing batch delivery sends everything (daily limit, 6h auto-delete, ban check unchanged).
Notes that are not Telegram links (e.g. Drive) open directly instead.

**Study timer.** The app sends a heartbeat every 30s. The server counts only *focus* time (breaks / pauses are
ignored), keeps live users in memory and saves a `StudySession` when the timer stops (or no heartbeat for 2 min).
Study days use IST. Sessions under 30s are discarded.

**Groups.** Roles: Admin (creator) > Co-admin (max 3) > Member. Co-admin can delete messages, pin, mute, remove
members and change chat settings. Only Admin can appoint co-admins, rename, change goal, delete the group.
A moderator can only act on someone of lower rank. Chat is polled every 4s, messages auto-delete after 30 days.
Group invite link: `https://t.me/<bot>?start=grp_<CODE>` -> bot sends a "Join Study Group" Mini App button.

## Deploy checklist
1. No new npm packages. No new env vars needed (`BOT_TOKEN`, `WEB_URL`, `MONGO_URI` already used).
   Optional: `BOT_USERNAME` (otherwise read from `bot.getMe()` at startup).
2. Deploy as ONE Node process. Live timers are in memory, so don't run several instances behind a load balancer.
3. First start creates the MongoDB collections and indexes automatically (incl. the 30-day chat TTL).
4. Open the app once in Telegram and test: start a timer, create a group, join with a second account.

## Known limits
* Global Room has no chat (spam risk); only live timers + today's leaderboard.
* A crash (not a normal restart/deploy) loses the running session's unsaved time.
* Deleted chat messages disappear for other people on their next full reload (incremental polling only adds new ones).
