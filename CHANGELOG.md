# Changelog

All notable changes to Haven Bot are documented here.

---

## [1.4.0] — 2026-06-01

### Added
- **AI Agent** — optional AI assistant powered by Ollama, loaded only when `AGENT_ENABLED=true`
  - Configurable slash command trigger (`AGENT_COMMAND` env var, default `/bob`)
  - Configurable agent name and persona (`AGENT_NAME`, `AGENT_SYSTEM_PROMPT`)
  - Separate `haven-agent.db` database — fully isolated from `haven-bot.db`
- **Web search** — SearXNG integration for real-time answers (`SEARXNG_URL`)
  - Auto-detects queries that need current information
  - Injects search results as grounding context into Ollama prompt
  - Skips search for queries handled by tools (leaderboard, calendar, etc.)
- **Persistent memory** — agent remembers facts across conversations and restarts
  - Per-user and per-channel memory scopes
  - `remember <fact>` — store a fact
  - `what do you know about me?` — recall stored facts
  - `forget everything about me` — clear memories
- **Conversation history** — rolling multi-turn context per channel
  - Configurable history size (`AGENT_HISTORY_SIZE`)
  - Persists across restarts
- **Haven Bot tool integration** — agent can take real actions
  - `list_calendar_events` — fetch upcoming events
  - `create_calendar_event` — add events with automatic reminders
  - `get_leaderboard` — fetch XP standings
  - `play_sound` — play soundboard sounds
  - `list_rss_feeds` — list monitored feeds
  - `get_datetime` — current date and time
  - Uses Ollama's native tool calling API for reliable execution
- **Participation modes** — configurable per channel at runtime
  - `command` — slash command only (default, safest)
  - `mention` — responds when full agent name appears in a message
  - `passive` — monitors messages, responds to questions and replies to its own questions
  - `active` — participates freely with cooldown
- **Per-channel agent configuration** — full persona switching without restart
  - `/bob config set-prompt` — custom system prompt
  - `/bob config set-mode` — participation mode
  - `/bob config set-name` — rename agent for this channel
  - `/bob config clear-history` — wipe conversation history
  - `/bob config clear-memory` — wipe channel memory
  - `/bob config enable/disable` — toggle agent (config commands work even when disabled)
  - `/bob config reset` — revert to global defaults
  - `/bob config show` — view current channel config
- **`/bob help`** — full AI Agent command reference, respects `HELP_DELETE_SECONDS`
- **AI Agent section in `/help`** — shown only when `AGENT_ENABLED=true`, shows model name

### Changed
- Agent slash command skips XP and achievement checks
- Thinking indicator (`_Bob is thinking..._`) deleted automatically when response arrives
- `deleteMessage` added to `channelBot` proxy for channel-aware deletion

---

## [1.3.3] — 2026-05-31

### Changed
- Removed `src/commands/music.js` — duplicate of `soundboard.js`, never imported
- Removed `src/commands/default.js` — leftover scaffold, never used
- Cleaned up `FIX #N` legacy debug comments throughout codebase
- Removed stack trace dump from null token error in `bot.js`
- Fixed stale docstring in `channels.js`

---

## [1.3.2] — 2026-05-31

### Fixed
- Duplicate command responses — `_getCommandHandler` in `bot.js` was firing after event emit
- `reqToken is not defined` in legacy message handler
- `enrichedData` and `channelBot` defined before XP block
- Pre-registration now runs in `ChannelManager` constructor
- `deleteMessage` added to `channelBot` proxy

### Added
- `/help` auto-delete via `HELP_DELETE_SECONDS` env var (also applies to startup greeting)
- `WEBHOOK_TOKENS` new format: `ChannelName:ChannelCode:Token`

---

## [1.3.1] — 2026-05-31

### Fixed
- `.env.example` `WEBHOOK_TOKENS` showed old format

---

## [1.3.0] — 2026-05-31

### Added
- **Multi-channel support** — one bot instance serves multiple Haven channels
- **`/calendar list all`** — admin command to view events across all channels

### Changed
- XP is now global across all channels
- Leaderboard is now global
- `/stats` shows global rank with per-channel message breakdown
- `/calendar list` shows current channel only

---

## [1.2.0] — 2026-05-31

### Added
- RSS feed reader, Calendar system, RSVP, Custom commands
- Soundboard, Achievements, Daily streak tracking
- Docker support, GitHub Actions, GHCR publishing
- Multi-channel registration, XP cooldown, configurable greetings

---

## [1.1.0] — 2026-05-30

### Added
- Moderation commands — `/ban`, `/kick`, `/warn`, `/mute`, `/unmute`, `/unban`
- Admin system, auto-kick at 3 warnings, audit logging

---

## [1.0.0] — 2026-05-27

### Added
- Initial release
- Haven webhook client with HMAC verification and rate limiting
- SQLite database, XP and leveling, leaderboards
- `/profile`, `/level`, `/stats`, `/daily`, `/leaderboard`, `/top`, `/ping`, `/help`
- Interactive setup wizard
