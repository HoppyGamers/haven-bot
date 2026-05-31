# Contributing to Haven Bot

Thank you for your interest in contributing! Haven Bot is a community project built for [Haven](https://github.com/ancsemi/Haven) self-hosted servers. Contributions of all kinds are welcome — bug fixes, new features, documentation improvements, and bug reports.

---

## 📋 Before You Start

- Check the [open issues](../../issues) to see if someone is already working on what you have in mind
- For large features, open an issue first to discuss the approach before writing code
- Haven Bot targets Node.js 20+ and uses only `better-sqlite3` and `dotenv` as runtime dependencies — keep it that way where possible

---

## 🐛 Reporting Bugs

Open an issue with:

- A clear title describing the problem
- Steps to reproduce it
- What you expected to happen vs what actually happened
- Your Node.js version (`node --version`)
- Relevant console output or error messages
- Your Haven server version if the issue involves the webhook API

---

## 💡 Suggesting Features

Open an issue tagged `enhancement` with:

- What the feature does
- Why it would be useful to the community (not just your specific server)
- Any Haven API endpoints it would depend on — check the [Haven documentation](https://github.com/ancsemi/Haven) first to confirm they exist

---

## 🛠️ Making Changes

### Setup

```bash
git clone https://github.com/HoppyGamers/haven-bot.git
cd haven-bot
npm install
cp .env.example .env
# Fill in your .env with a test Haven server
npm run dev
```

### Branch naming

```
feature/your-feature-name
fix/what-you-are-fixing
docs/what-you-are-documenting
```

### Workflow

1. Fork the repository
2. Create a branch from `main`
3. Make your changes
4. Test against a real Haven server
5. Submit a pull request

---

## 📐 Code Style

Haven Bot doesn't use a linter, but please follow the existing conventions:

- 2-space indentation
- Single quotes for strings
- `const` by default, `let` only when reassignment is needed
- Async/await over raw promises
- Named functions over anonymous arrow functions for top-level handlers
- Comments on anything non-obvious

**Error handling** — every command handler is wrapped in a try/catch in `index.js`. Individual functions should still handle expected errors (bad input, not found, permission denied) gracefully with user-friendly messages rather than throwing.

**Database operations** — all DB logic belongs in `database.js`. Commands should not write SQL directly.

**New commands** — add to the relevant file in `src/commands/`, export the handler, wire it in `src/index.js` (routes, skipXp list, skipAchievements list, registration list, and help text), and document it in `README.md`.

---

## 🗂️ Project Structure

```
src/
├── index.js          # Entry point — all command routing lives here
├── bot.js            # Haven webhook client — HTTP, rate limiting, HMAC
├── database.js       # All SQLite schema and operations
├── achievements.js   # Achievement definitions and check engine
├── notifier.js       # Calendar notification polling loop
├── rss.js            # RSS fetch, parse, and polling loop
├── setup.js          # Interactive .env setup wizard
├── commands/         # One file per feature area
│   ├── profiles.js   # XP, levels, leaderboards, daily, profile
│   ├── moderation.js # Ban, kick, warn, mute, admin management
│   ├── soundboard.js # Soundboard playback and listing
│   ├── calendar.js   # Events, notifications, RSVP
│   ├── rss.js        # RSS feed management commands
│   ├── custom.js     # Custom command CRUD
│   └── default.js    # Stub for additional handlers
└── utils/
    └── permissions.js # isAdmin, isBanned helpers
```

---

## ➕ Adding a New Command

1. **Add the handler** in the appropriate `src/commands/*.js` file
2. **Wire the route** in `src/index.js`:
   - Add a `case` in the switch statement
   - Add to `skipXp` if it shouldn't award XP
   - Add to `skipAchievements` if it can't trigger an achievement
   - Add to `commandList` for registration with Haven
   - Add to the `/help` text
3. **Document it** in `README.md` under the Command Reference table

---

## ➕ Adding a New Achievement

All achievements are defined in a single array in `src/achievements.js`. Add an entry:

```javascript
{
  key:         'my_achievement',   // unique, snake_case
  category:    'messages',        // messages | levels | streak | moderation | leaderboard
  name:        'My Achievement',
  description: 'What the user did to earn it',
  xp:          100,               // 0 for moderation badges
  icon:        '🎯',
}
```

Then add the unlock condition in `checkAchievements()` in the same file.

---

## 🔌 Haven API Compatibility

Haven Bot is built against [Haven](https://github.com/ancsemi/Haven). The bot API is documented in Haven's `GUIDE.md`. If you're adding a feature that calls a Haven endpoint:

- Verify the endpoint exists in the Haven source before building against it
- Note the Haven version your feature requires in the PR description
- Handle API errors gracefully — the bot should never crash on a Haven API failure

Currently known Haven bot API limitations:
- No ban or mute endpoints (feature request submitted)
- `GET /api/sounds` requires a user JWT, not a webhook token
- No way to target specific channels from a webhook

---

## 📬 Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Test your changes against a real Haven server before submitting
- Update `README.md` if you add or change commands
- Don't include `node_modules`, `.env`, or `*.db` files

---

## 📄 License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
