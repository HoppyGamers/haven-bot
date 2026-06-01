# Haven Bot

A fully featured community bot for [Haven](https://github.com/ancsemi/Haven) self-hosted voice chat servers, with an optional AI Agent powered by [Ollama](https://ollama.ai) and [SearXNG](https://searxng.org).

## Features

### 📊 User Profiles & XP
- Global XP pool across all channels
- Leveling system with level-up announcements
- Daily bonus with streak tracking
- `/profile`, `/level`, `/stats`, `/daily`, `/leaderboard`, `/top`

### 🏆 Achievements
- 16 achievements across 5 categories
- XP rewards and chat announcements on unlock

### 👮 Moderation
- `/ban`, `/kick`, `/warn`, `/mute`, `/unmute`, `/unban`
- Auto-kick at 3 warnings
- Audit log via `/modlog`
- Admin system with `/addadmin`, `/removeadmin`, `/admins`

### 📅 Calendar & Events
- Create events with `/calendar add`
- Automatic reminders at 1 day, 6 hours, and 30 minutes before
- RSVP with `/rsvp <id>`
- Per-channel event lists, with `/calendar list all` for admins

### 📰 RSS Feeds
- Monitor multiple feeds per channel
- Auto-post new items on a configurable interval
- `/rss add`, `/rss remove`, `/rss pause`, `/rss resume`, `/rss list`, `/rss check`

### 🎵 Soundboard
- `/soundboard <name>` — play Haven soundboard sounds
- `/sounds` — list configured sounds

### ⚙️ Custom Commands
- Create server-specific slash commands with `/addcommand`
- Edit and remove with `/editcommand`, `/removecommand`

### 🌐 Multi-Channel
- One bot instance serves multiple Haven channels
- Each channel gets its own bot webhook, all handled by a single process
- Commands reply to the channel they were issued in
- RSS feeds and calendar reminders post to the channel they were configured in

### 🤖 AI Agent (Optional)
- **Natural language interface** — chat with the AI Agent using a configurable slash command (e.g. `/bob`)
- **Web search** — answers grounded in real-time results via SearXNG
- **Persistent memory** — remembers facts across conversations and restarts
- **Conversation history** — multi-turn context so the agent follows long discussions
- **Tool integration** — agent can create calendar events, fetch leaderboards, play sounds, and list RSS feeds
- **Participation modes** — `command`, `mention`, `passive`, or `active`
- **Per-channel personas** — different name, prompt, and mode per channel at runtime
- **Powered by Ollama** — runs locally, no cloud dependencies

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your Haven server details. At minimum:

```env
HAVEN_SERVER_URL=https://your-haven-server.com
WEBHOOK_TOKEN=your_64_character_webhook_token_here
CALLBACK_URL=http://your-public-ip:3000/
DB_PATH=/data/haven-bot.db
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

## Multi-Channel Setup

Create one webhook per channel in Haven's Bot Management. All webhooks must point to the same `CALLBACK_URL` (Haven routes all slash commands through the primary bot's callback URL).

```env
# Format: ChannelName:ChannelCode:Token (comma separated)
# ChannelCode is the 8-character join code shown in the Haven channel header
WEBHOOK_TOKENS=General:a9b20e93:token1,Gaming:87057084:token2,Events:76fe37ad:token3
```

---

## AI Agent Setup

The AI Agent requires [Ollama](https://ollama.ai) running locally or on your network.

### 1. Install Ollama and pull a model

```bash
ollama pull qwen2.5:14b
```

`qwen2.5:7b` works for getting started. Upgrade to `14b` for better tool calling and instruction following.

### 2. Configure the agent

```env
AGENT_ENABLED=true
AGENT_NAME=Bob
AGENT_COMMAND=bob
AGENT_SYSTEM_PROMPT=You are Bob, a helpful AI assistant for the Haven voice chat server. Be concise and friendly.
AGENT_MODE=command
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b

# Optional — enables web search via SearXNG
SEARXNG_URL=http://localhost:8118
```

### 3. Use the agent

```
/bob tell me about yourself
/bob remember I prefer race results without spoilers
/bob what do you know about me?
/bob add the British Grand Prix to the calendar for July 5th at 9am
/bob who's at the top of the leaderboard?
/bob help
```

### Participation Modes

Set per-channel with `/bob config set-mode <mode>`:

| Mode | Behavior |
|---|---|
| `command` | Only responds to `/bob` slash commands (default) |
| `mention` | Responds when the agent's full name appears in a message |
| `passive` | Monitors messages, responds to questions it can answer |
| `active` | Participates freely, rate-limited by `AGENT_COOLDOWN` |

### Per-Channel Configuration

```
/bob config show                    — current channel config
/bob config set-prompt "You are..." — set custom persona for this channel
/bob config set-mode passive        — change participation mode
/bob config set-name Jeeves         — rename agent for this channel
/bob config clear-history           — wipe conversation history
/bob config clear-memory            — wipe channel memory
/bob config enable / disable        — toggle agent in this channel
/bob config reset                   — revert to global defaults
```

---

## Docker

```bash
docker compose up -d
```

Or pull the pre-built image:

```yaml
services:
  haven-bot:
    image: ghcr.io/hoppygamers/haven-bot:latest
    env_file: .env
    volumes:
      - /your/data/path:/data
    ports:
      - "3000:3000"
```

Update:
```bash
docker compose pull && docker compose up -d && docker image prune -f
```

---

## Project Structure

```
src/
├── bot.js              — Haven webhook client
├── channels.js         — Multi-channel token routing
├── database.js         — SQLite schema and all DB operations
├── index.js            — Entry point, command routing
├── notifier.js         — Calendar notification poller
├── rss.js              — RSS fetcher and poller
├── setup.js            — Interactive setup wizard
├── achievements.js     — Achievement definitions and engine
├── agent/              — AI Agent (loaded only when AGENT_ENABLED=true)
│   ├── agent.js        — Main agent handler, tool orchestration
│   ├── config.js       — Global/channel config resolution
│   ├── database.js     — Agent-specific SQLite database
│   ├── memory.js       — Persistent memory and recall
│   ├── modes.js        — Participation mode logic
│   ├── ollama.js       — Ollama API client with tool calling
│   ├── search.js       — SearXNG web search integration
│   └── tools.js        — Haven Bot tool definitions and execution
├── commands/
│   ├── calendar.js
│   ├── custom.js
│   ├── moderation.js
│   ├── profiles.js
│   ├── rss.js
│   └── soundboard.js
└── utils/
    └── permissions.js
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full reference with descriptions.

---

## Further Reading

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Design decisions and system overview
- [`HAVEN_API_NOTES.md`](HAVEN_API_NOTES.md) — Undocumented Haven API behaviors
- [`CHANGELOG.md`](CHANGELOG.md) — Version history
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Contributor guide

---

## 🤖 Built with AI Assistance

`haven-bot` was built using [vibe coding](https://en.wikipedia.org/wiki/Vibe_coding) — an AI-assisted development workflow where a human guides an AI through design decisions, debugging, and iteration. The project is fully functional but community review is welcome. If you find edge cases or bugs, please open an issue on GitHub.

---

## License

MIT — see [LICENSE](LICENSE) for details.
