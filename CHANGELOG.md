# Changelog

All notable changes to Haven Bot are documented here.

---

## [1.7.0] — 2026-06-03

### Added
- **Haven RPG System** — full text-based RPG engine powered by Ollama
  - Channel-based campaigns — each Haven channel runs its own independent campaign
  - 5 game systems: `dnd5e`, `starwars`, `cyberpunk`, `scifi`, `horror`
  - Committed action detection — `dmbob ACTION <what you do>` triggers narration and dice rolls
  - OOC question handling — `dmbob <question>` gets DM answers without advancing the scene
  - Automatic dice inference — attack, stealth, persuasion, perception, athletics checks auto-rolled
  - Manual dice rolls — `dmbob roll 1d20`, `2d6+3`, `4d6kh3`, `adv`, `dis`
  - Character creation with rolled stats (4d6 drop lowest), class HP, and AC
  - Party status tracking — HP bars, conditions, inventory per character
  - Game log persistence — full session history stored in `haven-rpg.db`
  - AI-generated session recaps — `dmbob rpg recap`
  - Campaign management — setup, join, start, pause, resume
  - Stage direction filtering — "ACTION:" and "Narrator:" labels automatically stripped from DM output
- **D&D 5e System** — full class and race roster with descriptions
  - 12 classes: Fighter, Wizard, Rogue, Cleric, Ranger, Paladin, Barbarian, Bard, Druid, Monk, Sorcerer, Warlock
  - 9 races: Human, Elf, Dwarf, Halfling, Gnome, Half-Orc, Half-Elf, Tiefling, Dragonborn
- **Star Wars System** — expanded from original implementation
  - 12 classes: Jedi, Rebel Soldier, Smuggler, Bounty Hunter, Pilot, Force Sensitive, Diplomat, Imperial Officer, Droid, Mandalorian, Scoundrel, Medic
  - 10 races including Twilek, Wookiee, Togruta, Mirialan
  - Full Force rules (Light/Dark side, Control/Sense/Alter), weapon damage values, Dark Side Points
- **Cyberpunk System** — new system
  - 10 classes: Netrunner, Solo, Nomad, Fixer, Techie, Rockerboy, Medtech, Corpo, Cop (Ex), Edgerunner
  - Hacking mechanics: Ghost Run vs Brute Force, ICE ratings, cyberspace consequences
  - Humanity score — cyberware costs humanity, 0 = cyberpsychosis
  - Blade Runner/Cyberpunk 2077 tone and street slang
- **Sci-Fi System** — gritty far-future space opera (The Expanse / Mass Effect tone)
- **Horror System** — survival horror investigation with Sanity mechanic (Call of Cthulhu lite)
- **RPG section in `/help`** — shown when `RPG_ENABLED=true`
- **`dmbob rpg systems`** — lists all available systems with descriptions
- **`dmbob rpg setup`** (no args) — shows systems overview with sample classes
- **`dmbob rpg setup <name> <system>`** — now shows full class and race list with descriptions after creation

### Fixed
- DM responses no longer include "ACTION:" stage directions or "Narrator:" labels
- Ollama timeout increased to 120s for RPG calls (larger context than standard agent queries)
- userId type coercion — Haven sends user_id as number, RPG DB stores as TEXT

### Changed
- RPG prompts include explicit NEVER rules for all 5 systems to prevent meta-instruction leakage

---

## [1.6.0] — 2026-06-03

### Added
- **Web Dashboard (Phase 5)** — browser-based admin panel on port 3003
  - Token-based authentication via `/dashboard token` slash command
  - Overview page — bot status, uptime, channel list, live service health
  - Users page — XP leaderboard, total users, total XP, achievement count
  - Calendar page — upcoming events with notification status and RSVP counts
  - RSS Feeds page — all feeds with item counts and last item title
  - Moderation Log page — recent actions with unban button
  - AI Agent Stats page — conversation counts, memory, tool usage chart, recent tool log
  - Settings page — runtime config (bot name, timezone, delete timers, RSS intervals) applied without restart
  - Write actions: create/edit/delete calendar events, add/remove/pause RSS feeds, add/remove channels, unban users
- **Runtime channel management** — add/remove channels without restart
  - `/addchannel <name> <code> <token>` — add a channel at runtime
  - `/removechannel <code>` — remove a DB-managed channel
  - `/channels` — list all configured channels with source indicator
  - Channels persist across restarts in `bot_channels` table
- **Fast startup** — slash command registration skipped on restart if commands unchanged
  - MD5 hash of command list + channels stored in `bot_settings` table
  - Subsequent restarts boot in seconds instead of 2+ minutes
  - Hash invalidates automatically when commands or channels change

### Fixed
- RSS duplicate posting — `item_title` column migration was missing, causing `markSeen` to fail silently
- `/rss check` now posts items to each feed's configured channel instead of the command channel
- Passive/mention mode no longer responds to slash commands (prevented duplicate responses)
- Calendar notifications now store `notify_at` in SQLite datetime format (was ISO format, broke comparisons)
- File upload paths no longer trigger unknown command errors
- Dashboard health page `process.env` reference removed from browser JS
- Duplicate API routes in dashboard server removed

### Changed
- `.env.example` rewritten — cleaner sections, bootstrap vs runtime channel explanation, all new vars documented
- `/calendar` help expanded with date format examples and notify offset explanation
- `/rss list` now shows which channel each feed posts to
- Auto-delete timers split into three categories: `HELP_DELETE_SECONDS`, `ADMIN_DELETE_SECONDS`, `USER_DELETE_SECONDS`

---

## [1.5.0] — 2026-06-02

### Added
- **RSS Digest (Phase 4A)** — scheduled AI summaries of RSS feed content
  - `/bob rss_digest add <threshold> <source_code> <dest_code> <daily|weekly> [day] <time>`
  - Collects real article titles from `rss_seen`, summarizes via Ollama
  - Prevents hallucination — prompt explicitly instructs use of real titles only
  - `/bob rss_digest list`, `run`, `remove` commands
  - Scheduler runs every 30 minutes
- **AI Event Briefing (Phase 4B)** — AI-enhanced calendar reminders
  - Fires alongside every calendar notification when agent is enabled
  - Searches SearXNG for current context about the event title
  - Adapts to any event type — races, game releases, movies, etc.
  - Non-blocking — plain reminder fires regardless of briefing success
- **Tool call logging** — all agent tool calls logged to `tool_log` table in `haven-agent.db`
- **English language enforcement** — agent always responds in English regardless of message language
- **`/bob help`** — full AI Agent command reference, respects `HELP_DELETE_SECONDS`
- **AI Agent section in `/help`** — shown only when `AGENT_ENABLED=true`

### Fixed
- Skipped RSS items no longer reappear — flood-limited items marked seen immediately
- Agent participation modes (mention/passive/active) now work correctly
- Passive mode responds to replies when Bob's last message was a question
- `/bob config disable` — agent can now be re-enabled after disabling (config commands bypass enabled check)
- Mention mode uses full agent name match to prevent false positives

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
