# ⬡ Haven Bot

A feature-rich community bot for [Haven](https://github.com/ancsemi/Haven) voice chat servers, built with Node.js and SQLite. Self-hosted, open-source, and designed to run alongside your Haven server with no external service dependencies.

---

## ✨ Features

### 👤 User Profiles & Leveling
- XP system with global and per-channel tracking
- Automatic level progression (100 XP per level)
- `/daily` bonus with streak tracking
- `/profile`, `/level`, `/stats` commands
- Level-up announcements mid-conversation

### 🏆 Leaderboards
- `/leaderboard` — channel top 10
- `/leaderboard global` — global top 10
- `/top [limit]` — global leaderboard with custom limit

### 🎖️ Achievements
- 16 achievements across 5 categories: Messages, Levels, Daily Streak, Moderation, and Leaderboard
- Announced in chat when earned
- XP rewards for most achievements
- Visible in `/profile`

### 🛡️ Moderation
- `/kick` — removes user from channel (live Haven API action)
- `/ban`, `/mute` — recorded locally with audit trail (pending Haven moderation API)
- `/warn` — warning system with auto-kick at 3 warnings
- `/modlog` — full audit trail
- Role-based admin system (`/addadmin`, `/removeadmin`, `/admins`)

### 🔊 Soundboard
- `/soundboard <name>` — play a sound for everyone in the channel
- `/sounds` — list configured sounds
- Configured via `SOUNDS=` in `.env`

### 📅 Calendar & Events
- Create events with `/calendar add 2026-04-13 17:00 Group Raid --notify 1d 6h 30m`
- Multiple notification reminders per event
- RSVP system with `/rsvp <id>`
- Timezone-aware display via `TIMEZONE=` in `.env`

### 📡 RSS Feed Reader
- Monitor multiple RSS/Atom feeds
- Automatic posting on configurable interval
- Keyword filtering per feed
- Pause/resume individual feeds

### ⚡ Custom Commands
- Create server-specific slash commands without touching code
- Supports `{user}`, `{channel}`, `{count}` variables
- Permission controlled (`admin` or `everyone`)

---

## 🚀 Quick Start

### Requirements

- [Haven](https://github.com/ancsemi/Haven) server (self-hosted)
- [Node.js](https://nodejs.org/) 20 or newer
- A Haven bot webhook token (see [Creating a Bot](#creating-a-bot))

### 1. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/haven-bot.git
cd haven-bot
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your Haven server details — or run the interactive setup wizard:

```bash
npm run setup
```

### 3. Run

```bash
npm start
```

Development mode (auto-restart on file changes):

```bash
npm run dev
```

---

## 🤖 Creating a Bot

1. Open your Haven server and go to **Settings → Server Admin Settings → Bots**
2. Create a new webhook — give it a name and optionally an avatar URL
3. Set a **Callback URL** — this is the public address Haven will POST slash commands to (e.g. `http://your-ip:3000`)
4. Set a **Callback Secret** — any random string, used for HMAC verification
5. Copy the **Webhook Token** (64-character hex string)
6. Add your token and callback details to `.env`

> Haven's bot documentation: [github.com/ancsemi/Haven](https://github.com/ancsemi/Haven)

---

## ⚙️ Configuration

All settings live in `.env`. Copy `.env.example` to get started. Key settings:

| Variable | Description | Default |
|---|---|---|
| `HAVEN_SERVER_URL` | Your Haven server URL | — |
| `WEBHOOK_TOKEN` | Bot webhook token from Haven admin | — |
| `CALLBACK_URL` | Public URL for slash command callbacks | — |
| `CALLBACK_SECRET` | HMAC verification secret | — |
| `PORT` | Callback server port | `3000` |
| `TIMEZONE` | IANA timezone for calendar display | `UTC` |
| `SOUNDS` | Comma-separated list of soundboard sound names | — |
| `CUSTOM_COMMANDS_PERMISSION` | Who can manage custom commands (`admin`/`everyone`) | `admin` |
| `RSS_CHECK_INTERVAL` | Minutes between RSS feed checks | `15` |
| `RSS_MAX_ITEMS` | Max new items posted per feed per check | `5` |
| `BOT_GREETING` | Startup message when bot comes online | Built-in default |
| `BOT_FIRST_TIME_GREETING` | Welcome message for first-time users (supports `{user}`) | Built-in default |
| `XP_COOLDOWN_MS` | Milliseconds between XP awards per user | `5000` |
| `DB_PATH` | Path to SQLite database file | `./haven-bot.db` |
| `DEBUG` | Enable verbose logging | `false` |

---

## 📋 Command Reference

### Profile
| Command | Description |
|---|---|
| `/profile [@user]` | View your profile or another user's |
| `/level` | Check your channel level and XP |
| `/stats` | Detailed stats and global rank |
| `/daily` | Claim daily XP bonus (resets at midnight) |

### Leaderboards
| Command | Description |
|---|---|
| `/leaderboard` | Channel top 10 |
| `/leaderboard global` | Global top 10 |
| `/top [limit]` | Global leaderboard with custom limit (max 25) |

### Soundboard
| Command | Description |
|---|---|
| `/soundboard <name>` | Play a soundboard sound |
| `/sounds` | List configured sounds |
| `/stopsound` | Stop current sound *(not yet supported by Haven API)* |

### Calendar
| Command | Description |
|---|---|
| `/calendar add <date> <time> <title> [--notify <offsets>]` | Create an event (admin) |
| `/calendar list` | Upcoming events |
| `/calendar view <id>` | Event details and attendees |
| `/calendar edit <id> <field> <value>` | Edit title, date, or time (admin) |
| `/calendar delete <id>` | Delete an event (admin) |
| `/rsvp <id>` | Toggle attendance |

Notify offsets: `1d` `6h` `30m` — creates one reminder per offset.

### RSS Feeds
| Command | Description |
|---|---|
| `/rss add <url> [--filter <keyword>]` | Add a feed (admin) |
| `/rss remove <id>` | Remove a feed (admin) |
| `/rss pause <id>` | Pause a feed (admin) |
| `/rss resume <id>` | Resume a feed (admin) |
| `/rss list` | Show all feeds |
| `/rss check` | Manually trigger a check (admin) |

### Custom Commands
| Command | Description |
|---|---|
| `/customcommands` | List all custom commands |
| `/addcommand <name> <response>` | Create a command (admin) |
| `/editcommand <name> <response>` | Edit a command (admin) |
| `/removecommand <name>` | Delete a command (admin) |

Response variables: `{user}`, `{channel}`, `{count}`

### Moderation *(admin only)*
| Command | Description |
|---|---|
| `/kick @user [reason]` | Kick user from channel *(live Haven API)* |
| `/ban @user [reason]` | Record a ban *(log only — pending Haven API)* |
| `/unban @user` | Clear a ban record |
| `/warn @user [reason]` | Issue a warning (3 = auto-kick) |
| `/mute @user [duration] [reason]` | Record a mute *(log only — pending Haven API)* |
| `/unmute @user` | Clear a mute record |
| `/warnings [@user]` | Check warnings |
| `/modlog` | View recent moderation actions |
| `/addadmin [@user] [role]` | Add admin or moderator |
| `/removeadmin @user` | Remove an admin |
| `/admins` | List all admins |

Duration format: `30m`, `2h`, `1d`

> **Note:** Haven currently only exposes a kick endpoint via the bot API. Ban and mute commands record actions locally for audit purposes. A [feature request](https://github.com/ancsemi/Haven/issues) has been submitted for full moderation API support.

---

## 🐳 Docker

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/haven-bot.git
cd haven-bot

# Configure
cp .env.example .env
# Edit .env with your Haven server details

# Start
docker compose up -d

# View logs
docker compose logs -f

# Update after pulling new code
docker compose build && docker compose up -d

# Backup database
docker compose cp haven-bot:/data/haven-bot.db ./backup.db
```

The database is stored in a named Docker volume (`haven_data`) and persists across container restarts and updates.

---

## 📁 Project Structure

```
haven-bot/
├── src/
│   ├── index.js          # Entry point, command routing
│   ├── bot.js            # Haven webhook client
│   ├── database.js       # SQLite schema and operations
│   ├── achievements.js   # Achievement definitions and engine
│   ├── notifier.js       # Calendar notification runner
│   ├── rss.js            # RSS fetcher and poller
│   ├── setup.js          # Interactive setup wizard
│   ├── commands/
│   │   ├── profiles.js   # Profile, XP, leaderboard commands
│   │   ├── moderation.js # Moderation commands
│   │   ├── soundboard.js # Soundboard commands
│   │   ├── calendar.js   # Calendar and RSVP commands
│   │   ├── rss.js        # RSS feed commands
│   │   ├── custom.js     # Custom command management
│   │   └── default.js    # Stub for additional commands
│   └── utils/
│       └── permissions.js # Permission helpers
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

---

## 🔐 Security

- **Never commit `.env`** — it contains your webhook token. It is gitignored by default.
- **Set `CALLBACK_SECRET`** — enables HMAC signature verification on incoming callbacks. Without it, anyone who knows your callback URL can send fake commands.
- **Admin system** — uses Haven's numeric user IDs. The first admin must be added via `/addadmin` and is granted bootstrap access automatically.
- **Database** — `haven-bot.db` is stored locally and unencrypted. Restrict filesystem access on shared servers.

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
