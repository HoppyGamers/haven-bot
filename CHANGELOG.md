# Changelog

All notable changes to Haven Bot are documented here.

---

## [1.3.3] — 2026-05-31

### Changed
- Removed `src/commands/music.js` — duplicate of `soundboard.js`, was never imported
- Removed `src/commands/default.js` — leftover scaffold from early Discord bot attempt, never used
- Cleaned up `FIX #N` legacy debug comments throughout codebase — replaced with proper descriptions
- Removed stack trace dump from null token error in `bot.js` — was a debugging aid, too noisy for production
- Fixed stale docstring in `channels.js` referencing `/cb/<token>` instead of `/cb/<n>`

---

## [1.3.2] — 2026-05-31

### Fixed
- **Duplicate command responses** — `_getCommandHandler` in `bot.js` was firing after the `command` event emit, causing every command to execute twice. Removed the redundant handler calls since `index.js` owns all routing via the event system.
- **`reqToken is not defined`** — legacy `message` event handler referenced `reqToken` which was only defined in the `slash_command` block. Removed the unnecessary `registerChannel` call since channels are pre-registered from env at startup.
- **Channel routing timing** — `enrichedData` and `channelBot` were defined after the XP/achievement block that used them, causing `channel_id` to be undefined for level-up and achievement announcements. Moved both definitions before the XP block.
- **Pre-registration timing** — `preRegisterFromEnv()` was called in `main()` after the callback server started, allowing callbacks to arrive before the channel map was populated. Moved to the `ChannelManager` constructor so the map is always ready before anything else runs.
- **Pre-registered channels being overwritten** — runtime `registerChannel()` calls could overwrite the pre-registered map with incorrect token associations. Fixed to respect existing entries.

### Added
- **`/help` auto-delete** — configurable via `HELP_DELETE_SECONDS` env var. Set to a number of seconds to automatically delete the help message after it's read (e.g. `HELP_DELETE_SECONDS=60`). Default `0` = never delete. Keeps channels clean without needing manual deletion.
- **`WEBHOOK_TOKENS` new format** — `ChannelName:ChannelCode:Token` combines all three channel identifiers in one entry, eliminating the need for a separate `WEBHOOK_CHANNEL_CODES` env var and preventing order-mismatch bugs.
- **Warning log** — when the channel manager falls back to the primary token (channel not in map), a warning is now logged to make routing issues easier to diagnose.
- **Stack trace logging** — null token errors now include a stack trace to identify which call is missing channel context.

### Changed
- `WEBHOOK_TOKENS` format updated from `Token:ChannelName` to `ChannelName:ChannelCode:Token` — old format still supported for backward compatibility
- `preRegisterFromEnv()` removed from `main()` startup sequence — now runs automatically in `ChannelManager` constructor
- `/cb/<n>` callback paths use short numeric index instead of full 64-character token to avoid URL length issues in Haven's UI

### Notes
- **Haven 3.19.0** — the Haven server bug where all slash commands were routed through whichever bot's callback URL was saved most recently has been fixed. Each channel's bot now correctly uses its own callback URL. Update Haven to 3.19.0 to take advantage of this fix.

---

## [1.3.1] — 2026-05-31

### Fixed
- `.env.example` `WEBHOOK_TOKENS` example showed old `token:ChannelName` format instead of new `ChannelName:ChannelCode:Token` format

---

## [1.3.0] — 2026-05-31

### Added
- **Multi-channel support** — one bot instance now serves multiple Haven channels simultaneously
  - Configure via `WEBHOOK_TOKENS=ChannelName:ChannelCode:Token,...` in `.env`
  - Commands reply to the channel they were issued in
  - RSS feeds and calendar reminders post to the channel they were configured in
  - `/calendar list all` shows events across all channels (admin only)
  - Fully backward compatible — single-channel setups using `WEBHOOK_TOKEN` unchanged

### Changed
- **XP is now global** — XP earned in any channel contributes to one unified pool per user
- **Leaderboard is now global** — `/leaderboard` shows server-wide rankings
- **`/level`** — shows global level and total messages across all channels
- **`/stats`** — shows global rank with a per-channel message breakdown
- **`/calendar list`** — shows events for the current channel only (use `list all` for all channels)

### Fixed
- Dead `_getCommandHandler` ping handler in `bot.js` causing duplicate responses
- `enrichedData` and `channelBot` defined before XP block so channel routing works correctly
- `preRegisterFromEnv` now runs in constructor so channel map is populated before first callback

---

## [1.2.0] — 2026-05-31

### Added
- **RSS feed reader** — monitor multiple RSS/Atom feeds with `/rss add/remove/pause/resume/list/check`
- **Calendar system** — create events with reminders via `/calendar add/list/view/edit/delete`
- **RSVP system** — toggle attendance with `/rsvp <id>`
- **Custom commands** — create server-specific slash commands with `/addcommand`, `/editcommand`, `/removecommand`, `/customcommands`
- **Soundboard** — play Haven soundboard sounds with `/soundboard`, list with `/sounds`
- **Achievements** — 16 achievements across 5 categories with XP rewards and chat announcements
- **Daily streak tracking** — consecutive day bonuses with streak reset detection
- **XP spam cooldown** — configurable cooldown between XP awards (`XP_COOLDOWN_MS`)
- **First-time user greeting** — configurable welcome message for new users (`BOT_FIRST_TIME_GREETING`)
- **Startup greeting** — configurable bot online message (`BOT_GREETING`)
- **`/top [limit]`** — configurable limit up to 25 users
- **`/removeadmin`** — remove admin access
- **Level up announcements** — mid-conversation level up notifications
- **Docker support** — `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- **GitHub Actions** — automatic Docker image builds to GHCR on push to main
- **`/health` endpoint** — Docker health check endpoint
- **TIMEZONE env var** — IANA timezone for calendar event display
- **SOUNDS env var** — comma-separated soundboard sound names
- **DB_PATH env var** — configurable database path for Docker volume support

### Changed
- `/leaderboard` merged with global view (always global now)
- `/profile` accepts optional `@username` argument
- `/profile` shows only earned achievements
- Ban, mute, unmute, unban now attempt Haven moderation API with clear fallback messaging
- Custom command names restricted to alphanumeric and hyphens only
- Moderation commands excluded from XP awards

### Fixed
- Daily bonus cooldown used `updated_at` instead of dedicated `last_daily_claim` column
- Channel level never updated after XP was awarded
- Circular dependency between `rss.js` and `database.js`
- `args` parsed before `enrichedData` was defined

---

## [1.1.0] — 2026-05-30

### Added
- **Moderation commands** — `/ban`, `/kick`, `/warn`, `/mute`, `/unmute`, `/unban`, `/warnings`, `/modlog`
- **Admin system** — `/addadmin`, `/admins` with bootstrap flow for first admin
- **Auto-kick** — automatic kick at 3 warnings
- **Audit logging** — all moderation actions logged to `mod_logs` table
- **Database migrations** — safe `ALTER TABLE ADD COLUMN` on startup

### Fixed
- Callback payload shape mismatch (`data.message` vs flat `data`)
- `args` parsing from raw message content

---

## [1.0.0] — 2026-05-27

### Added
- Initial release
- Haven webhook client with HMAC verification and rate limiting
- SQLite database with XP, leveling, leaderboards
- `/profile`, `/level`, `/stats`, `/daily`, `/leaderboard`, `/top` commands
- `/ping`, `/help` commands
- Interactive setup wizard (`npm run setup`)
