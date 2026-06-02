# Haven Bot — Project Status & Roadmap

Last updated: June 3, 2026

---

## ✅ Completed Phases

| Phase | Description | Version |
|-------|-------------|---------|
| Phase 1 | Database, XP, Leveling, Achievements | 1.0.0 |
| Phase 2 | Moderation — ban, kick, warn, mute, audit log | 1.1.0 |
| Phase 3 | AI Agent — Ollama, SearXNG, memory, tools, participation modes | 1.4.0 |
| Phase 4 | Scheduled tasks — RSS digest, AI event briefings | 1.5.0 |
| Phase 5 | Web Dashboard — full read/write admin panel | 1.6.0 |
| Phase 6 | RPG System — Ollama-powered text adventure engine | 1.7.0 |

---

## 🔲 Remaining Phases

### Phase 7 — Voice Integration
- **Status:** Blocked — Haven has not yet exposed a voice API
- No ETA — dependent on Haven upstream development
- Will enable: agent responds to voice activity in channels, voice-triggered commands

---

## 📋 Flagged Features

These were identified during development and deferred for later consideration.

### Auto-Moderation (Phase 2B)
- Spam detection — flag rapid message spam (e.g. 5+ messages in 10 seconds)
- Auto-warn on spam violations
- Profanity filter — configurable word list
- Escalation system — auto warn → mute → kick progression

### `/setup` Wizard
- One-time interactive setup that walks through configuration and writes `.env`
- Reduces barrier to entry for new self-hosters
- Covers: server URL, webhook token, callback URL, timezone, agent setup

### Recurring Calendar Events
- Weekly/monthly event recurrence
- e.g. "Every Sunday at 9am — F1 Race Day"
- Currently all events are one-time only

### Channel Message Digest
- Summarize all messages in a channel over a time window
- Requires opt-in message storage per channel (privacy consideration)
- Use case: daily summary of a busy channel posted to an admin channel
- Deferred due to storage complexity — revisit when there's clear demand

### Dashboard Settings Persistence
- Settings saved via the dashboard apply immediately via `process.env`
- But RSS poller, notifier, and other services read env vars at startup
- Full persistence requires services to re-read settings at runtime
- Workaround: restart bot after changing settings

---

## 🐛 Known Issues / Tech Debt

| Issue | Notes |
|-------|-------|
| Dashboard token posted publicly | Token visible to all channel members — waiting on Haven ephemeral message support |
| Settings don't fully persist across restart | `process.env` changes lost on restart; `bot_settings` DB saves values but services need updating to read from DB at runtime |
| SearXNG response time / flapping | DuckDuckGo (100 errors) still enabled — disabling failing engines would improve stability |

---

## 🚀 Haven Feature Requests Submitted

| Request | Status |
|---------|--------|
| Subcommand support for slash commands | Submitted |
| Ephemeral / private bot messages | Submitted |

---

## 💡 Future Ideas (Not Scoped)

- **Web dashboard auth via Haven SSO** — once Haven exposes OAuth/SSO
- **Plugin/module system** — allow community-contributed commands to be loaded without modifying core
- **Multi-server support** — one bot instance managing multiple Haven servers
- **Mobile-friendly dashboard** — current dashboard is desktop-focused
- **Bot-to-bot communication** — coordinate between multiple bots on the same server
