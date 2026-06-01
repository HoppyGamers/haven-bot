# Haven Bot — Architecture & Design Decisions

This document explains why the bot is built the way it is. Useful context for contributors and for resuming development after a break.

---

## Core Architecture

### Single Process, Multiple Channels

The bot runs as one Node.js process handling all configured channels. This was a deliberate choice over running one process per channel:

- One SQLite database shared across all channels (users, XP, achievements, calendar, RSS)
- One callback server receiving all Haven events
- One set of pollers (notification runner, RSS poller)
- Simpler deployment — one Docker container, one `.env`

The tradeoff is that a crash affects all channels simultaneously. For a self-hosted community server this is acceptable.

### Channel Routing

Haven routes all slash command callbacks through the **General/primary bot's callback URL** regardless of which channel the command was issued in. This is a Haven behavior (bug fixed in Haven 3.19.0 — see `HAVEN_API_NOTES.md`).

The bot handles this via `src/channels.js` — a `ChannelManager` singleton that maps `channelCode → token` so replies go to the correct channel:

```
Haven POST /callback → bot receives channelCode in payload
→ ChannelManager.getToken(channelCode) → correct webhook token
→ bot.sendMessage(content, channelCode) → replies in correct channel
```

Channel codes must be pre-registered via `WEBHOOK_TOKENS` env var since the token can't be derived from the callback payload.

### Command Routing

All command routing lives in `src/index.js`. The flow is:

```
Haven callback → bot.js parses payload → emits 'command' event
→ index.js switch statement → command handler
→ channelBot proxy → bot.sendMessage(content, channel_id)
```

The `channelBot` Proxy wraps the bot instance and automatically injects `channel_id` into every `sendMessage` and `playSound` call so command handlers don't need to pass it explicitly.

**Important:** `_getCommandHandler` in `bot.js` is intentionally stripped of all handlers except an empty stub. All routing is in `index.js`. Do not add command handlers back to `bot.js`.

---

## Database Design

### Global XP, Per-Channel Message Counts

XP is stored in `users.xp` (global). Message counts are stored in `user_stats` (per-channel). This was a deliberate decision:

- Users shouldn't have to "grind" separately in each channel
- Leaderboard reflects overall server engagement
- Per-channel message counts are a secondary stat shown in `/stats` breakdown

### SQLite Migrations

All schema changes use `ALTER TABLE ADD COLUMN` in the migrations array in `initializeDatabase()`. This is safe to run repeatedly — duplicate column errors are caught and ignored.

When adding a new column, always add a migration entry even if it's in the `CREATE TABLE` statement. Users upgrading from older versions won't have the column otherwise.

### Foreign Keys

`foreign_keys = ON` is set at startup. All moderation tables (bans, mutes, warnings) use `ensureUserExists()` before inserting to prevent FK constraint failures when moderating users who haven't interacted with the bot yet.

---

## Multi-Channel Configuration

```
WEBHOOK_TOKENS=ChannelName:ChannelCode:Token,...
```

- **ChannelName** — friendly name for logs
- **ChannelCode** — 8-character Haven join code (visible in channel header)
- **Token** — 64-character webhook token from Haven Bot Management

The channel code is critical for routing. Without it, replies go to the primary channel. Channel codes are pre-registered in `ChannelManager` constructor so they're available before the first callback arrives.

**All bots must share the same callback URL** (the primary/General bot's URL). Haven fixed per-bot callback routing in 3.19.0 but the pre-registration approach still works as a fallback.

---

## Key Files

| File | Purpose |
|---|---|
| `src/index.js` | Entry point, all command routing, XP/achievement triggers |
| `src/bot.js` | Haven webhook client — HTTP, rate limiting, HMAC, callback server |
| `src/channels.js` | Channel code → token mapping, multi-channel management |
| `src/database.js` | All SQLite schema and operations |
| `src/achievements.js` | Achievement definitions and check engine |
| `src/notifier.js` | Calendar notification polling loop (every 60s) |
| `src/rss.js` | RSS fetch, parse, and polling loop (configurable interval) |
| `src/setup.js` | Interactive .env setup wizard |
| `src/commands/profiles.js` | XP, levels, leaderboards, daily, profile |
| `src/commands/moderation.js` | Ban, kick, warn, mute, admin management |
| `src/commands/soundboard.js` | Soundboard playback and listing |
| `src/commands/calendar.js` | Events, notifications, RSVP |
| `src/commands/rss.js` | RSS feed management commands |
| `src/commands/custom.js` | Custom command CRUD |
| `src/utils/permissions.js` | isAdmin, isBanned helpers |

---

## XP & Leveling

- 10 XP per command (subject to 5-second cooldown per user)
- 100 XP per daily bonus claim
- Level formula: `level = floor(xp / 100) + 1`
- XP awards are skipped for moderation, admin, and management commands
- Achievement checks are skipped for read-only commands (help, profile, leaderboard)

---

## Achievement System

All achievements defined in `src/achievements.js` `ACHIEVEMENTS` array. Adding a new achievement:

1. Add entry to `ACHIEVEMENTS` array with `key`, `category`, `name`, `description`, `xp`, `icon`
2. Add unlock condition in `checkAchievements()` in the same file
3. Achievements are seeded to DB on startup via `INSERT OR IGNORE`

Achievement checks run after every XP-earning command. The check queries total messages, global rank, and streak — keep the check lightweight.

---

## RSS Feed Design

- No external XML parser — uses Node.js built-in `https`/`http`
- Handles RSS 2.0 and Atom feeds
- Follows HTTP redirects
- Strips HTML tags from descriptions
- Deduplicates via `rss_seen` table (GUID per feed)
- On first add, marks all current items as seen to prevent flooding old content
- Caps at `RSS_MAX_ITEMS` per check to prevent flooding after downtime
- `channel_id` stored on feed — posts go to the channel where `/rss add` was run

---

## Calendar & Notifications

- Events stored in UTC, displayed in `TIMEZONE` env var
- Notification times pre-calculated at event creation time
- Notifier polls every 60 seconds for `notify_at <= now AND sent = 0`
- `ON DELETE CASCADE` on notifications and RSVPs — deleting an event cleans up everything
- `/calendar list` shows current channel only; `/calendar list all` (admin) shows all channels

---

## Soundboard

- Haven's `GET /api/sounds` requires a user JWT, not a webhook token — bots cannot call it
- Sound list configured via `SOUNDS=` env var (comma-separated sound names)
- Sound names must match exactly as they appear in Haven's soundboard settings
- `/soundboard <name>` passes the name directly to Haven's `POST /api/webhooks/<token>/sounds`

---

## Moderation API

Haven exposes these endpoints via webhook token (no user JWT needed):

```
POST /api/webhooks/<token>/moderation/kick    { userId, channelCode, reason? }
POST /api/webhooks/<token>/moderation/ban     { userId, reason? }
POST /api/webhooks/<token>/moderation/unban   { userId }
POST /api/webhooks/<token>/moderation/mute    { userId, duration?, reason? }
POST /api/webhooks/<token>/moderation/unmute  { userId }
```

Requires `can_moderate` checkbox enabled on the bot in Haven's Bot Management. The `kick` command uses the issuing admin's Haven user ID as the moderator. Ban and mute are also live API calls when `can_moderate` is enabled.

---

## Rate Limiting

Haven limits webhook endpoints to 30 requests/minute per IP. The bot handles this with:

- A request queue in `bot.js` — rate-limited requests are queued and replayed after the window resets
- Command registration paces at 25 requests per window with a 61-second pause between batches
- 100ms gap between individual command registrations

With 3 channels × 29 commands = 87 registrations, startup takes ~3 minutes on first run.

---

## AI Agent Architecture

### Overview

The agent lives entirely in `src/agent/` and is loaded only when `AGENT_ENABLED=true`. If disabled, it has zero impact on the bot — no modules are required, no database is opened.

### Entry Point

`src/agent/agent.js` is the main handler. It:
1. Initializes the agent database (`haven-agent.db`)
2. Health-checks Ollama and SearXNG
3. Registers the agent slash command on all channels
4. Handles incoming commands via `handleAgentCommand()`
5. Handles per-channel config via `handleConfigCommand()`

### Request Flow

```
User: /bob add the British GP to the calendar for July 5th at 9am

1. index.js routes /bob command to handleAgentCommand()
2. config.js resolves channel config (global defaults + channel overrides)
3. memory.js injects persistent user/channel facts into system prompt
4. search.js checks if query needs web search — skips for tool-handled queries
5. ollama.js calls chatWithTools() with TOOL_DEFINITIONS
6. Ollama returns tool_calls: [{ name: "create_calendar_event", arguments: {...} }]
7. tools.js executes create_calendar_event → writes to haven-bot.db
8. ollama.js called again with tool result → natural language response
9. bot.sendMessage() posts to the correct channel
```

### Databases

Two separate SQLite files:
- `haven-bot.db` — bot data (users, XP, calendar, RSS, moderation)
- `haven-agent.db` — agent data (conversations, memory, channel config, tool log)

The agent reads from `haven-bot.db` (via tools) but writes agent-specific data to `haven-agent.db`. This keeps agent data isolated and allows the agent to be removed cleanly.

### Tool Calling

Uses Ollama's native tool/function calling API (not text-based patterns). Tools are defined in `tools.js` as structured definitions and passed to Ollama via the `tools` parameter. Ollama returns structured `tool_calls` in the response which are then executed and the results fed back for a natural language follow-up response.

### Participation Modes

Modes are handled by `modes.js`. The `message` event is emitted by `bot.js` for all non-webhook messages, and `index.js` registers a listener when `AGENT_ENABLED=true`. The listener calls `shouldRespond()` which checks the channel's configured mode before routing to `handleAgentCommand()`.

### Config Resolution

`config.js` uses a two-layer system:
1. Global defaults from `.env`
2. Per-channel overrides from `agent_channels` table in `haven-agent.db`

Any null field in the DB falls back to the global default. Config changes take effect immediately — no restart required.
