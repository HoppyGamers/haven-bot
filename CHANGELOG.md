# Changelog

All notable changes to Haven Bot are documented here.

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
