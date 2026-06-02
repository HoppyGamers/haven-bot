# Haven Bot — RPG System

An Ollama-powered text adventure engine built into Haven Bot. Each Haven channel can host its own independent campaign with persistent state, character sheets, dice rolls, and AI narration.

---

## Quick Start

### 1. Enable in `.env`

```env
RPG_ENABLED=true
AGENT_ENABLED=true
AGENT_NAME=Bob
```

### 2. Set up a campaign

```
bob rpg setup Curse of Strahd dnd5e
```

The bot responds with all available classes and races for the chosen system.

### 3. Players join

```
bob rpg join Aesmodien Fighter Elf
bob rpg join Boorder Druid Human
```

Each player gets a character with rolled stats (4d6 drop lowest), class HP, and AC.

### 4. DM starts

```
bob rpg start
```

Ollama generates the opening scene. Campaign is live.

### 5. Play

```
bob ACTION I push open the tavern door and step inside
bob what does the barkeeper look like?
bob roll 1d20
```

---

## How Actions Work

### Committed Actions — `bob ACTION <what you do>`

The `ACTION` keyword signals a committed in-game move. The DM narrates the result and calls for a dice roll automatically based on what you're doing.

```
bob ACTION I draw my sword and charge the orc chieftain
→ 🎲 Attack Roll: 1d20+3 → [14] = 17
→ ⚔️ Bob: Your blade catches the firelight as you surge forward...
```

### OOC Questions — `bob <question>`

Anything without `ACTION` is treated as out-of-character. The DM answers without advancing the scene.

```
bob what's the DC to pick this lock?
bob do you think my character would know about this cult?
```

### Player-to-Player Chat

Messages between players that don't address the DM are ignored. Talk freely.

---

## Dice Rolling

### Automatic Rolls

The system infers roll type from your ACTION text:

| Keywords | Roll Type |
|----------|-----------|
| attack, strike, slash, stab, shoot, cast | Attack Roll |
| sneak, hide, stealth, creep | Stealth Check |
| persuade, convince, deceive, intimidate | Charisma Check |
| search, examine, investigate, scout | Perception Check |
| climb, jump, sprint, force open | Athletics Check |
| dodge, tumble, balance, acrobat | Acrobatics Check |

### Manual Rolls

```
bob roll 1d20
bob roll 2d6+3
bob roll 4d6kh3       (keep highest 3)
bob roll adv          (advantage — 2d20 keep highest)
bob roll dis          (disadvantage — 2d20 keep lowest)
```

---

## Commands

### Setup

| Command | Description |
|---------|-------------|
| `bob rpg systems` | List all game systems |
| `bob rpg setup <name> [system]` | Create campaign in this channel |
| `bob rpg join <name> <class> <race>` | Join with a character |
| `bob rpg start` | Begin the campaign (DM only) |

### During Play

| Command | Description |
|---------|-------------|
| `bob ACTION <action>` | Committed in-game move |
| `bob <question>` | OOC question to the DM |
| `bob roll <dice>` | Manual dice roll |
| `bob rpg status` | Party HP and conditions |
| `bob rpg sheet` | Your character sheet |
| `bob rpg inventory` | Your inventory |
| `bob rpg recap` | AI session summary |

### DM Controls

| Command | Description |
|---------|-------------|
| `bob rpg pause` | Freeze the campaign |
| `bob rpg resume` | Resume a paused campaign |
| `bob rpg help` | Full command reference |

---

## Game Systems

### `dnd5e` — D&D 5e (Simplified)

Classic high fantasy — dungeons, dragons, and magic.

**12 Classes:** Fighter, Wizard, Rogue, Cleric, Ranger, Paladin, Barbarian, Bard, Druid, Monk, Sorcerer, Warlock

**9 Races:** Human, Elf, Dwarf, Halfling, Gnome, Half-Orc, Half-Elf, Tiefling, Dragonborn

**Rules:** d20 + modifier vs DC. Attack vs AC. Death saves at 0 HP.

---

### `starwars` — Star Wars

Jedi, smugglers, bounty hunters, and the Force.

**12 Classes:** Jedi, Rebel Soldier, Smuggler, Bounty Hunter, Pilot, Force Sensitive, Diplomat, Imperial Officer, Droid, Mandalorian, Scoundrel, Medic

**10 Races:** Human, Twilek, Wookiee, Rodian, Mon Calamari, Bothan, Zabrak, Togruta, Mirialan, Droid

**Rules:** 2d6 + attribute vs difficulty. Force: Light side vs Dark side. Dark Side Points accumulate.

---

### `cyberpunk` — Cyberpunk

Neon-soaked dystopia — hackers, mercs, and corporate espionage.

**10 Classes:** Netrunner, Solo, Nomad, Fixer, Techie, Rockerboy, Medtech, Corpo, Cop (Ex), Edgerunner

**5 Backgrounds:** Human, Full Borg, Street Kid, Corporate, Nomad

**Rules:** d20 + skill vs DC. Hacking: Ghost Run vs Brute Force against ICE. Humanity score — cyberware costs Humanity, 0 = cyberpsychosis.

---

### `scifi` — Sci-Fi

Gritty far-future space opera. Think The Expanse or Mass Effect.

**7 Classes:** Soldier, Engineer, Pilot, Medic, Hacker, Scout, Diplomat

---

### `horror` — Horror

Survival investigation with Sanity mechanics. Think Call of Cthulhu.

**7 Classes:** Detective, Doctor, Journalist, Occultist, Academic, Soldier, Criminal

**Rules:** Sanity starts at 10, reduced by witnessing horrors. 0 = unplayable. HP is low. Combat is rarely the right answer.

---

## Multi-Player

Campaigns support multiple players in the same channel. State is fully persistent — pick up days later from exactly where you left off.

**Async-friendly:** Players don't need to be online simultaneously. The DM narrates absent characters as hanging back without penalizing anyone.

---

## Database

RPG state stored in `haven-rpg.db` (separate from bot and agent databases):

| Table | Contents |
|-------|----------|
| `campaigns` | Channel mapping, system, status, current scene |
| `characters` | Player characters with full stat blocks |
| `game_log` | All actions, narrations, and dice rolls |
| `sessions` | Session timestamps and summaries |
| `combat` | Active combat state and initiative |

---

## Tips

- **Model matters** — `qwen2.5:14b` gives significantly better narration than smaller models
- **Be descriptive** — `I carefully examine the runes for magical traps` gets better narration than `I look at the door`
- **Use OOC for tactics** — ask `bob do you think I could bluff the guard?` before committing to an action
- **Recap between sessions** — `bob rpg recap` catches everyone up at the start of a new session
- **One channel per campaign** — run D&D in one channel and Star Wars in another simultaneously
