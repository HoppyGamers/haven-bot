# Changelog

All notable changes to Haven Bot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [1.1.0] — 2026-05-31

### Added
- **Full moderation API support** — kick, ban, unban, mute, and unmute now call Haven's live moderation endpoints (requires Haven 3.18.0+, `can_moderate` enabled on the webhook)
- **Calendar system** — create and manage server events with `/calendar add/list/view/edit/delete`
- **Event notifications** — configurable reminders per event (e.g. `--notify 1d 6h 30m`)
- **RSVP system** — `/rsvp <id>` to toggle attendance, shown in reminders and event view
- **RSS feed reader** — monitor multiple RSS/Atom feeds with `/rss add/remove/pause/resume/list/check`
- **RSS keyword filtering** — `--filter <keyword>` per feed
- **Custom commands** — create server-specific slash commands with `/addcommand`, `/editcommand`, `/removecommand`, `/customcommands`
- **Custom command variables** — `{user}`, `{channel}`, `{count}` supported in responses
- **Achievements system** — 16 achievements across 5 categories (Messages, Levels, Daily Streak, Moderation, Leaderboard)
- **Achievement announcements** — posted in chat when earned, with XP rewards
- **Soundboard commands** — `/soundboard <name>`, `/sounds`, `/stopsound`
- **Level-up announcements** — posted mid-conversation when a user levels up
- **Daily streak tracking** — streak counter with reset detection and feedback
- **Streak achievements** — 3, 7, and 30 day streak badges
- **`/leaderboard global`** — merged global leaderboard into the existing `/leaderboard` command
- **`/top [limit]`** — configurable limit (default 10, max 25)
- **`/profile [@user]`** — view another user's profile by @mention
- **`/stats` achievement count** — shows earned/total achievements
- **`/removeadmin`** command with self-removal guard
- **`/addadmin` and `/admins`** command routing
- **XP spam cooldown** — configurable via `XP_COOLDOWN_MS` (default 5 seconds)
- **First-time user greeting** — configurable via `BOT_FIRST_TIME_GREETING`
- **Startup greeting** — configurable via `BOT_GREETING`
- **`TIMEZONE`** env var — IANA timezone for calendar event display
- **`SOUNDS`** env var — comma-separated soundboard sound names
- **`CUSTOM_COMMANDS_PERMISSION`** env var — `admin` or `everyone`
- **`RSS_CHECK_INTERVAL`** env var — minutes between feed checks
- **`RSS_MAX_ITEMS`** env var — max items posted per feed per check
- **`DB_PATH`** env var — configurable database path for Docker
- **Docker support** — `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- **`GET /health`** endpoint — for Docker health checks and monitoring
- **Startup command registration** — all commands registered with Haven on boot
- **Error resilience** — all command handlers wrapped in try/catch; errors reported in chat without crashing

### Changed
- `/leaderboard` now accepts `global` argument instead of requiring separate `/top` command
- `/profile` now shows only earned achievements (empty categories hidden)
- `/daily` no longer double-counts XP as a channel message
- `/help` decluttered — custom command management moved to `/customcommands`
- Achievement checks skipped for commands that can't affect rank or message count
- Moderation commands excluded from XP awards
- `modLogs.log()` now stores `duration_minutes` per Phase 2 spec
- All moderation actor fields store username instead of raw Haven numeric ID
- Ban, mute, warn, unmute, unban responses updated to reflect live API status

### Fixed
- `data.message` shape mismatch crash in all moderation commands
- Mute duration parse condition was inverted (fixed `!match` → `match`)
- `/daily` cooldown used `updated_at` (broken by any XP award) — replaced with dedicated `last_daily_claim` column
- `last_daily_claim` migration added for existing databases
- `daily_streak` migration added for existing databases
- `duration_minutes` migration added for `mod_logs` table
- `/stats` rank always showed 0 for users outside top 100 — replaced with SQL COUNT query
- `user_stats.level` never updated after XP was awarded
- `/profile @user` could crash if `getProfile()` returned null
- Streak reset was silent — now shows `💔 Streak Reset` message
- `admin_users` FK insert failed silently when target user not in `users` table
- `ensureUserExists()` added before all ban/warn/mute inserts
- All moderation `parseData()` destructures were missing `username`
- `bot.js` callback parser updated for Haven's `slash_command` event format (was parsing `message` events)
- `args` now pre-parsed from Haven's `slash_command` payload
- `timestamp: undefined` in slash command events — fallback to `new Date().toISOString()`
- `GET /api/sounds` returned 401 (requires user JWT) — replaced with `SOUNDS` env var
- `/soundboard` showed invalid command when args were empty before callback format fix
- RSS circular dependency (`rss.js` → `database.js` → `rss.js`) resolved by injecting `rssFeeds` as parameter
- Custom command names now validated to alphanumeric and hyphens only
- `_gitignore` renamed to `.gitignore` so Git actually picks it up
- `.env.example` created (was referenced in README but missing)
- `haven.db` identified as empty Haven server file — not part of bot

### Security
- All outbound requests now include `Authorization: Bearer <token>` header
- HMAC callback signature verification documented and enabled by default
- Docker image runs as non-root `node` user
- `.dockerignore` prevents `.env` and `*.db` from being baked into images

---

## [1.0.0] — 2026-05-30

### Added
- Initial release
- **Haven webhook client** — send messages, delete messages, play sounds, register slash commands
- **HMAC signature verification** — validates incoming callback payloads
- **Rate limiting** — 30 req/min with automatic queue and retry
- **SQLite database** — `users`, `channels`, `user_stats`, `mod_logs` tables
- **XP and leveling system** — 100 XP per level, global and per-channel tracking
- **`/profile`** — view user profile with level and XP
- **`/level`** — check channel level and XP to next level
- **`/stats`** — detailed global and channel statistics with rank
- **`/daily`** — claim 100 XP daily bonus
- **`/leaderboard`** — channel top 10
- **`/top`** — global top 5
- **`/ping`** — test the bot
- **`/help`** — command listing
- **Moderation tables** — `admin_users`, `warnings`, `bans`, `mutes` (Phase 2 schema)
- **Permission system** — admin/moderator roles via `/addadmin`
- **`/ban`, `/kick`, `/warn`, `/mute`, `/unmute`, `/unban`** — moderation commands (local logging)
- **`/warnings`** — check warning count for a user
- **`/modlog`** — audit trail of recent moderation actions
- **Auto-kick** — triggered at 3 warnings
- **`setup.js`** — interactive `.env` setup wizard
- **`default.js`** — stub for custom command extensions

---

[Unreleased]: https://github.com/HoppyGamers/haven-bot/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/HoppyGamers/haven-bot/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/HoppyGamers/haven-bot/releases/tag/v1.0.0
