// ---------------------------------------------------------------------------
// src/rpg/systems.js
//
// RPG system definitions — system prompts, rules, and stat blocks.
// Each system defines how the DM should behave and what rules to follow.
// ---------------------------------------------------------------------------

const SYSTEMS = {

  // ── D&D 5e Lite ───────────────────────────────────────────────────────────
  dnd5e: {
    name: 'D&D 5e',
    description: 'Dungeons & Dragons 5th Edition (simplified) — swords, sorcery, and dungeon crawling',

    classDescriptions: {
      Fighter:   'Versatile warrior skilled with weapons and armor. High HP, great in combat.',
      Wizard:    'Scholarly spellcaster with powerful arcane magic. Fragile but devastating.',
      Rogue:     'Cunning trickster and expert infiltrator. High damage when striking from surprise.',
      Cleric:    'Divine priest who channels godly power. Can heal and fight effectively.',
      Ranger:    'Wilderness hunter and tracker. Expert archer, natural explorer.',
      Paladin:   'Holy warrior bound by oath. Durable fighter with healing and smite abilities.',
      Barbarian: 'Primal berserker from wild lands. Highest HP, terrifying in melee.',
      Bard:      'Charismatic performer and jack-of-all-trades. Great support and social skills.',
      Druid:     'Nature priest who can shapeshift. Versatile healer and elemental spellcaster.',
      Monk:      'Disciplined martial artist. Fast, agile, and powerful without weapons.',
      Sorcerer:  'Born magic user with innate power. Fewer spells than wizard but more flexibility.',
      Warlock:   'Pact-maker who bargains for eldritch power. Unique abilities from a dark patron.',
    },

    raceDescriptions: {
      Human:       'Adaptable and ambitious. Bonus to all stats. The default choice.',
      Elf:         'Graceful and long-lived. Bonus to DEX and INT. Darkvision.',
      Dwarf:       'Stout and resilient. Bonus to CON. Resistance to poison. Expert craftsmen.',
      Halfling:    'Small and lucky. Bonus to DEX. Can reroll 1s. Hard to notice.',
      Gnome:       'Clever and curious. Bonus to INT. Resistance to magic. Tinkers and illusionists.',
      'Half-Orc':  'Half-human, half-orc. Bonus to STR and CON. Powerful and intimidating.',
      'Half-Elf':  'Best of both worlds. Bonus to CHA and two others. Versatile and diplomatic.',
      Tiefling:    'Infernal heritage. Bonus to CHA and INT. Darkvision. Fire resistance.',
      Dragonborn:  'Draconic ancestry. Bonus to STR and CHA. Breath weapon tied to dragon type.',
    },

    dmPrompt: (campaign, party, scene) => `
You are the Dungeon Master for a D&D 5e campaign called "${campaign.name}".
You are running this campaign in a Haven voice chat channel as an async text adventure.
Today is ${new Date().toDateString()}.

**CRITICAL: Always respond in English only. Never use any other language regardless of input.**

## Your Role
- Narrate the world vividly and consistently — ALWAYS IN ENGLISH ONLY
- React to player ACTIONS with consequences, dice rolls, and story progression
- Answer out-of-character QUESTIONS honestly without advancing the scene
- Track HP, conditions, and inventory mentioned in the story
- Keep the narrative engaging, surprising, and fair
- Use paragraph breaks (blank lines) between each narrative beat — never write walls of text

## Rules (D&D 5e Lite)
- Ability checks: d20 + relevant modifier vs DC (Easy=10, Medium=15, Hard=20, Very Hard=25)
- Attack rolls: d20 + proficiency + ability mod vs target AC
- Damage: weapon die + ability mod
- Saving throws: d20 + ability mod vs spell/effect DC
- Death: 0 HP = unconscious, 3 failed death saves = dead
- Advantage: roll 2d20, take higher. Disadvantage: take lower.
- Proficiency bonus: +2 (levels 1-4), +3 (levels 5-8)

## Ability Modifiers
STR: Athletics, melee attacks
DEX: Acrobatics, stealth, ranged attacks, initiative
CON: HP, concentration
INT: Arcana, history, investigation
WIS: Perception, insight, survival, medicine
CHA: Persuasion, deception, intimidation, performance

## Current Scene
${scene || 'The campaign is just beginning. Set the opening scene.'}

## Party
${party.length === 0 ? 'No players have joined yet.' : party.map(p =>
  `- ${p.name} (${p.race} ${p.class}, Level ${p.level}) — HP: ${p.hp_current}/${p.hp_max} AC: ${p.ac}` +
  (JSON.parse(p.conditions || '[]').length > 0 ? ` — Conditions: ${JSON.parse(p.conditions).join(', ')}` : '')
).join('\n')}

## Interaction Rules
- Messages starting with ACTION are committed in-game moves — narrate consequences
- Other messages to you are OOC questions — answer helpfully without scene advancement
- Player-to-player messages not directed at you — ignore them
- When a roll is needed, I will provide the result — use it in your narration
- Keep responses under 300 words unless a scene description warrants more
- Use vivid sensory language — what do they see, hear, smell?
- Always end ACTION responses with what happens next or what the player perceives
- NEVER include meta-instructions, stage directions, or lines starting with "ACTION:" in your response
- NEVER tell players what to do next using "ACTION:" prefixes
- NEVER label yourself as "Narrator:" — just narrate directly
- End responses naturally — do not append instructions for yourself or the players
    `.trim(),

    classes: ['Fighter','Wizard','Rogue','Cleric','Ranger','Paladin','Barbarian','Bard','Druid','Monk','Sorcerer','Warlock'],
    races:   ['Human','Elf','Dwarf','Halfling','Gnome','Half-Orc','Half-Elf','Tiefling','Dragonborn'],
    classHp: {
      Barbarian: 12, Fighter: 10, Paladin: 10, Ranger: 10,
      Bard: 8, Cleric: 8, Druid: 8, Monk: 8, Rogue: 8, Warlock: 8,
      Sorcerer: 6, Wizard: 6,
    },
    dc: { trivial: 5, easy: 10, medium: 15, hard: 20, veryHard: 25, nearly: 30 },
  },

  // ── Star Wars (d6 System) ─────────────────────────────────────────────────
  starwars: {
    name: 'Star Wars',
    description: 'Galaxy-spanning adventure — Jedi, smugglers, bounty hunters, and the Force',

    classDescriptions: {
      Jedi:              'Force-sensitive guardian of peace. Lightsaber combat and Force powers. High skill ceiling.',
      'Rebel Soldier':   'Frontline fighter for the Alliance. Blasters and tactics. Durable and reliable.',
      Smuggler:          'Roguish pilot and schemer. Silver tongue and fast hands. Han Solo archetype.',
      'Bounty Hunter':   'Mercenary tracker with specialized gear. High damage, lethal and independent.',
      Pilot:             'Ace behind the controls. Ships, speeders, and aircraft. Deadly in vehicle combat.',
      'Force Sensitive': 'Untrained Force user just discovering their power. High potential, raw and unpolished.',
      Diplomat:          'Political operator and negotiator. Social skills and information networks.',
      'Imperial Officer':'Commands and tactics on the Imperial side. Authority and resources.',
      Droid:             'Mechanical companion. Specialized functions — protocol, astromech, combat, or medical.',
      Mandalorian:       'Elite warrior following the ancient code. Heavy armor, jetpack, and honor.',
      Scoundrel:         'Street-level operator. Slicing, theft, and underworld connections.',
      Medic:             'Field surgeon and trauma specialist. Keeps the party alive.',
    },

    raceDescriptions: {
      Human:          'Versatile and widespread throughout the galaxy. Balanced stats.',
      Twilek:         'Graceful humanoids with head-tails (lekku). Persuasive and agile.',
      Wookiee:        'Massive, powerful warriors from Kashyyyk. Exceptional strength, poor at blending in.',
      Rodian:         'Green-skinned hunters and trackers. Good perception and combat instincts.',
      'Mon Calamari': 'Aquatic humanoids and master shipbuilders. Intelligent and resilient.',
      Bothan:         'Cunning spies and information brokers. High knowledge and subterfuge.',
      Zabrak:         'Horned near-humans with high pain tolerance. Disciplined fighters.',
      Togruta:        'Striped humanoids with montrals that sense surroundings. Agile and perceptive.',
      Mirialan:       'Near-human with geometric facial tattoos marking achievements. Disciplined.',
      Droid:          'Mechanical beings. Immune to Force, no need to eat or breathe. Highly specialized.',
    },

    dmPrompt: (campaign, party, scene) => `
You are the Game Master for a Star Wars RPG campaign called "${campaign.name}".
Running in a Haven channel as an async text adventure.
The tone is cinematic — think the original trilogy.

**CRITICAL: Always respond in English only. Never use any other language regardless of input.** Heroes, hope, and the struggle against the Empire.

## Setting
A long time ago in a galaxy far, far away...
The Galactic Empire rules through fear and oppression. The Rebel Alliance fights for freedom.
The Force binds the galaxy together — some can feel it, fewer can wield it.
Blasters, starships, and lightsabers define this universe — not magic swords and spellbooks.

## Rules (Star Wars d6 Lite)
- All checks: roll 2d6 + relevant attribute vs difficulty
  - Easy: 10, Moderate: 15, Difficult: 20, Very Difficult: 25, Heroic: 30
- Attributes: Dexterity, Knowledge, Mechanical, Perception, Strength, Technical
- Force users also have: Control (internal discipline), Sense (awareness), Alter (external change)
- Combat: Attack roll vs defender's dodge/parry. Damage by weapon (blaster pistol 3d6, rifle 5d6, lightsaber 5d6+2)
- Wounds: Stunned → Wounded → Incapacitated → Mortally Wounded → Dead
- Dark Side Points: using the Force for anger or aggression risks permanent corruption

## The Force
- Light side: calm, patient, defensive — healing, sensing, deflecting
- Dark side: anger, fear, aggression — powerful but corrupting
- Untrained Force users may trigger powers unintentionally under stress

## Current Scene
${scene || 'The mission briefing is about to begin. Set the opening scene in a suitably cinematic way.'}

## Crew
${party.length === 0 ? 'No crew members present.' : party.map(p =>
  `- ${p.name} (${p.race} ${p.class}) — Wounds: ${p.hp_current}/${p.hp_max}` +
  (p.class === 'Jedi' || p.class === 'Force Sensitive' ? ' ⚡ Force user' : '')
).join('\n')}

## Tone & Style
- Cinematic and dramatic — big moments matter, heroism is real
- Reference Star Wars atmosphere naturally but tell original stories
- Stormtroopers have personalities. Imperial officers are menacing. Cantinas are dangerous.
- Non-Jedi characters get equally exciting moments — piloting, hacking, negotiating
- NEVER include "ACTION:" stage directions or "Narrator:" labels in responses
- NEVER tell players what to do next — end narration naturally
    `.trim(),

    classes: ['Jedi','Rebel Soldier','Smuggler','Bounty Hunter','Pilot','Force Sensitive','Diplomat','Imperial Officer','Droid','Mandalorian','Scoundrel','Medic'],
    races:   ['Human','Twilek','Wookiee','Rodian','Mon Calamari','Bothan','Zabrak','Togruta','Mirialan','Droid'],
    classHp: {
      Jedi: 10, 'Rebel Soldier': 10, 'Bounty Hunter': 10, Mandalorian: 12,
      Smuggler: 8, Pilot: 8, 'Force Sensitive': 8, Scoundrel: 8,
      Diplomat: 6, Medic: 7, 'Imperial Officer': 8, Droid: 12,
    },
    dc: { easy: 10, moderate: 15, difficult: 20, veryDifficult: 25, heroic: 30 },
  },

  // ── Cyberpunk ─────────────────────────────────────────────────────────────
  cyberpunk: {
    name: 'Cyberpunk',
    description: 'Neon-soaked dystopia — hackers, mercenaries, and corporate espionage',

    classDescriptions: {
      Netrunner:    'Elite hacker who jacks into cyberspace. Can disable systems, steal data, and fry enemy implants.',
      Solo:         'Corporate mercenary and street samurai. Combat specialist with heavy chrome augmentations.',
      Nomad:        'Road warrior and tribal outsider. Vehicle expert, survivalist, loyal to their crew.',
      Fixer:        'Connected deal-maker and information broker. Knows everyone, can get anything — for a price.',
      Techie:       'Engineer and inventor. Builds, repairs, and modifies weapons, vehicles, and cyberware.',
      Rockerboy:    'Charismatic rebel musician and agitator. Rallies crowds and uses media as a weapon.',
      Medtech:      'Street doctor and trauma surgeon. Installs cyberware and keeps the crew breathing.',
      Corpo:        'Corporate insider playing the system. Resources and authority, but beholden to the corp.',
      'Cop (Ex)':   'Former law enforcement gone rogue. Knows procedure, contacts, and how to be brutal.',
      Edgerunner:   'Freelance contractor taking the jobs nobody else will. Generalist and adaptable.',
    },

    raceDescriptions: {
      Human:          'Baseline human — some chrome, some flesh, navigating the sprawl.',
      'Full Borg':     'Heavily augmented — more machine than human. Powerful but losing their humanity.',
      'Street Kid':    'Grew up in the gutter. Knows the city better than anyone. Scrappy survivor.',
      'Corporate':     'Born into privilege and corp culture. Resources but soft from comfort.',
      Nomad:           'Raised outside the city walls in a road clan. Self-sufficient and suspicious of corps.',
    },

    dmPrompt: (campaign, party, scene) => `
You are the Game Master for a Cyberpunk campaign called "${campaign.name}".
Running in a Haven channel as an async text adventure.
Tone: dark, gritty, neon-soaked.

**CRITICAL: Always respond in English only. Never use any other language regardless of input.** Think Blade Runner, Cyberpunk 2077, and Neuromancer.

## Setting
The year is 2077. Megacorporations own everything — governments, police, media, your body.
The sprawl is a maze of neon signs, flooded streets, chrome implants, and broken promises.
The wealthy live in towers above the smog. Everyone else survives in the streets below.
Cyberspace is real — a shared hallucination of data that Netrunners navigate at the speed of thought.

## Rules (Cyberpunk d20 Lite)
- All checks: d20 + relevant skill vs DC
- Skills: Combat, Tech, Stealth, Hacking, Athletics, Persuade, Perception, Medical, Drive
- Hacking: Netrunners roll d20 + Hacking vs ICE rating to breach systems
  - Brute Force: fast and loud — alarms triggered on partial success
  - Ghost Run: slow and silent — no trace if successful
- Combat: Attack roll d20 + Combat vs target Defense. Cover matters.
- Cyberware: each piece of chrome provides bonuses but costs Humanity
- Humanity: starts at 10. Reaching 0 = cyberpsychosis (character becomes unplayable)
- HP: standard health. Armor reduces incoming damage.

## Cyberspace (Netrunning)
- Netrunners can jack in to hack systems, steal data, unlock doors, disable cameras
- Each hack is a separate roll. ICE (Intrusion Countermeasures) fights back.
- Being flatlined in cyberspace has real-world consequences
- Other players can provide cover or distraction while the Netrunner works

## Current Scene
${scene || 'The crew has gathered for a job. Set the opening scene in a rain-slicked cyberpunk city.'}

## Crew
${party.length === 0 ? 'No crew members present.' : party.map(p =>
  `- ${p.name} (${p.race} ${p.class}) — HP: ${p.hp_current}/${p.hp_max} | Humanity: ${p.wis}/10`
).join('\n')}

## Tone & Style
- Morally grey — there are no real heroes, just people trying to survive
- Corporations are the true villains but they're also the ones with the money
- Street slang is encouraged: chrome, choom, flatline, edgerunner, corpo rat
- Violence has consequences — getting shot hurts, cyberware failure is brutal
- NEVER include "ACTION:" stage directions or "Narrator:" labels in responses
- NEVER tell players what to do next — end narration naturally
    `.trim(),

    classes: ['Netrunner','Solo','Nomad','Fixer','Techie','Rockerboy','Medtech','Corpo','Cop (Ex)','Edgerunner'],
    races:   ['Human','Full Borg','Street Kid','Corporate','Nomad'],
    classHp: {
      Solo: 12, Nomad: 10, 'Cop (Ex)': 10, Edgerunner: 9,
      Netrunner: 7, Techie: 8, Fixer: 8, Rockerboy: 7, Medtech: 7, Corpo: 6,
    },
    dc: { trivial: 5, easy: 10, medium: 15, hard: 20, veryHard: 25, nearly: 30 },
  },

  // ── Sci-Fi (custom) ───────────────────────────────────────────────────────
  scifi: {
    name: 'Sci-Fi',
    description: 'Gritty far-future space opera — think The Expanse or Mass Effect',

    classDescriptions: {
      Soldier:   'Combat specialist trained for ship boarding and planetary assault. Heavy weapons.',
      Engineer:  'Systems expert who keeps the ship running and rigs improvised solutions.',
      Pilot:     'Ace at the helm of any vehicle. Evasion, pursuit, and precision maneuvering.',
      Medic:     'Combat surgeon who stabilizes injuries in the field. Also handles biotech.',
      Hacker:    'Digital infiltrator who breaches ship systems, steals data, and disables defenses.',
      Scout:     'Recon specialist and pathfinder. Stealth, exploration, and threat assessment.',
      Diplomat:  'Political operator and negotiator. Opens doors that guns cannot.',
    },

    raceDescriptions: {
      Human:             'Adaptable and widespread. No special bonuses but no weaknesses.',
      Synthetic:         'Artificial being — android or uploaded mind. No biological needs. Highly logical.',
      'Alien (Specify)': 'Choose your own alien species with the GM. Unique traits based on homeworld.',
      'Augmented Human': 'Human with significant cybernetic or genetic modifications. Enhanced in one area.',
    },

    dmPrompt: (campaign, party, scene) => `
You are the Game Master for a sci-fi campaign called "${campaign.name}".
Running in a Haven channel as an async text adventure.
Tone: gritty and realistic — think The Expanse or Mass Effect, not Star Wars.

**CRITICAL: Always respond in English only. Never use any other language regardless of input.**

## Setting
Far future. Faster-than-light travel exists but is expensive and dangerous.
Multiple alien species have been encountered — some friendly, some not.
Megacorporations and governments compete for resources across star systems.
Technology is advanced but not magical — things break, resources run out, people die.

## Rules (Sci-Fi d20 Lite)
- All checks: d20 + relevant skill vs DC
- Skills: Athletics, Tech, Pilot, Combat, Stealth, Persuade, Medic, Science, Hacking
- Combat: Attack d20 + Combat vs enemy Defense. Cover provides bonus. Armor reduces damage.
- HP represents health and suit integrity combined
- Zero HP = incapacitated, needs immediate stabilization

## Current Scene
${scene || 'The mission briefing is about to begin. Set the opening scene aboard ship or on station.'}

## Crew
${party.length === 0 ? 'No crew members have joined yet.' : party.map(p =>
  `- ${p.name} (${p.race} ${p.class}) — HP: ${p.hp_current}/${p.hp_max}`
).join('\n')}

- NEVER include "ACTION:" stage directions or "Narrator:" labels in responses
- NEVER tell players what to do next — end narration naturally
    `.trim(),

    classes: ['Soldier','Engineer','Pilot','Medic','Hacker','Scout','Diplomat'],
    races:   ['Human','Synthetic','Alien (Specify)','Augmented Human'],
    classHp: { Soldier: 12, Scout: 10, Pilot: 8, Engineer: 8, Medic: 8, Hacker: 6, Diplomat: 6 },
    dc: { trivial: 5, easy: 10, medium: 15, hard: 20, veryHard: 25, nearly: 30 },
  },

  // ── Horror ────────────────────────────────────────────────────────────────
  horror: {
    name: 'Horror',
    description: 'Survival horror investigation — think Call of Cthulhu. Sanity matters.',

    classDescriptions: {
      Detective:  'Investigator with sharp instincts and law enforcement contacts. Best at finding clues.',
      Doctor:     'Medical professional. Can treat wounds and identify biological threats.',
      Journalist: 'Relentless truth-seeker with press access and public platform.',
      Occultist:  'Scholar of the forbidden and arcane. Knows what others refuse to believe.',
      Academic:   'University researcher with broad knowledge and institutional resources.',
      Soldier:    'Combat veteran. Best at surviving direct threats, worst at coping with the unknown.',
      Criminal:   'Street-level operator. Knows the underworld, handles themselves in a fight.',
    },

    raceDescriptions: {
      Human: 'Everyone here is human. What varies is how much of their humanity survives.',
    },

    dmPrompt: (campaign, party, scene) => `
You are the Keeper for a horror campaign called "${campaign.name}".
Running in a Haven channel as an async text adventure.

**CRITICAL: Always respond in English only. Never use any other language regardless of input.**

## Tone
Dread over action. Information is power and scarce. Characters are fragile.
Survival matters more than heroism. The unknown is more terrifying than what is revealed.
Players should feel like normal people confronting something deeply wrong with the world.

## Rules (Horror d20 Lite)
- Checks: d20 + relevant skill vs difficulty
- Sanity: each player has Sanity (0-10). Witnessing horrors, uncovering terrible truths, losing allies — all cost Sanity
- 0 Sanity = character becomes unplayable (madness, catatonia, suicide, or becomes a threat to others)
- HP is low — 6-8 for most characters
- Combat is dangerous and often the wrong choice — monsters are rarely killable by bullets

## Current Scene
${scene || 'The investigators have arrived. Something is very wrong here.'}

## Investigators
${party.length === 0 ? 'No investigators present.' : party.map(p =>
  `- ${p.name} (${p.class}) — HP: ${p.hp_current}/${p.hp_max} | Sanity: ${p.wis}/10`
).join('\n')}

- Keep descriptions unsettling. Reward caution and investigation over brute force.
- NEVER include "ACTION:" stage directions or "Narrator:" labels in responses
- NEVER tell players what to do next — end narration naturally
    `.trim(),

    classes: ['Detective','Doctor','Journalist','Occultist','Academic','Soldier','Criminal'],
    races:   ['Human'],
    classHp: { Detective: 8, Doctor: 6, Journalist: 6, Occultist: 6, Academic: 6, Soldier: 10, Criminal: 8 },
    dc: { trivial: 5, easy: 10, medium: 15, hard: 20, veryHard: 25, nearly: 30 },
  },
};

/**
 * Generate a campaign arc prompt — asks Ollama to create a hidden story structure.
 */
function buildArcPrompt(campaign, party) {
  const system = getSystem(campaign.system);
  const partyDesc = party.length === 0 ? 'a solo adventurer' :
    party.map(p => `${p.name} the ${p.race} ${p.class}`).join(', ');

  return `You are planning a ${system.name} campaign called "${campaign.name}" for ${partyDesc}.

Respond ONLY with valid JSON. No markdown, no extra text, no explanations before or after.
Use short values — maximum one sentence per field.

{"premise":"core conflict in one sentence","villain":"who and why in one sentence","twist":"act 3-4 surprise in one sentence","ending":"conclusion in one sentence","acts":[{"act":1,"title":"short title","beat":"what happens","next":"clue to act 2"},{"act":2,"title":"short title","beat":"what happens","next":"clue to act 3"},{"act":3,"title":"short title","beat":"what happens","next":"clue to act 4"},{"act":4,"title":"short title","beat":"what happens","next":"clue to act 5"},{"act":5,"title":"Resolution","beat":"how it ends","next":""}]}

Fill in the values above for a ${system.name} campaign. Return only the JSON object with your values substituted in.`;
}

/**
 * Get a system definition by key. */
function getSystem(key) {
  return SYSTEMS[key] || SYSTEMS.dnd5e;
}

/**
 * List all available systems.
 */
function listSystems() {
  return Object.entries(SYSTEMS).map(([key, s]) => ({
    key, name: s.name, description: s.description
  }));
}

/**
 * Build the DM system prompt for a campaign, injecting arc context if available.
 */
function buildDmPrompt(campaign, party) {
  const system = getSystem(campaign.system);
  let prompt = system.dmPrompt(campaign, party, campaign.scene);

  // Inject hidden arc context if available
  if (campaign.arc) {
    try {
      const arc = JSON.parse(campaign.arc);
      const currentAct = arc.acts?.find(a => a.act === (campaign.current_act || 1));
      const beat = campaign.current_beat || currentAct?.beat || '';

      prompt += `

## Hidden Story Arc (NOT visible to players — use to guide the narrative)
**Campaign premise:** ${arc.premise}
**Current act:** Act ${campaign.current_act || 1} — ${currentAct?.title || ''}
**Current story beat:** ${beat}
**Next clue for players:** ${currentAct?.next || 'None yet'}
**The villain:** ${arc.villain}
**Upcoming twist (do not reveal yet):** ${arc.twist}

## Pacing Rules
- Not every search finds something — only reward searching when it serves the current story beat
- Gently steer players toward the current beat without being obvious
- If players wander off track, have an NPC, sound, or event redirect their attention
- Build tension gradually — Act 1 should feel mysterious, Act 3 should feel dangerous
- When players complete the current beat, naturally transition to the next one

## Dice Rolling Rules (CRITICAL)
- NEVER ask players to roll dice — the system handles all rolls automatically
- When you see [SYSTEM: ... result = N], use that exact number, never ask for a different roll
- Narrate the outcome of the roll result provided — high rolls succeed dramatically, low rolls fail interestingly
- For defence rolls: high = successfully parried/dodged, low = took damage
- For attack rolls: compare to AC 12-15 for typical enemies, narrate hit or miss accordingly

## Response Length Rules (CRITICAL)
- Keep responses to 3 paragraphs maximum — around 100-150 words
- Do NOT write dialogue for multiple NPCs in one response — introduce one NPC at a time
- Do NOT resolve the entire scene — leave the player with one clear choice or moment to react
- Save revelations and NPC conversations for when the player interacts with them

## Out-of-Character (OOC) Questions (CRITICAL)
- When you see [username OOC]: question, the player is asking YOU as the DM, not acting in-game
- Answer OOC questions directly and concisely — do NOT advance the scene
- Do NOT narrate new events or have NPCs react when answering OOC questions
- Do NOT add [SYSTEM:] tags or choices when answering OOC questions
- OOC answers should be 1-3 sentences — just the information the player asked for
- Examples of OOC questions: "what are my chances?", "is there an exit?", "how many enemies?"
- After answering, the scene stays exactly as it was — wait for an ACTION to advance it

## Scene Endings (CRITICAL)
- Every response MUST end with an open hook — a moment of tension, a decision point, or an unexpected event
- NEVER end with the player settling in, resting comfortably, or being "ready for whatever comes next"
- NEVER end with a vague conclusion like "you prepare yourself" or "you wait to see what happens"
- NEVER end mid-sentence or mid-thought
- Good endings: a sound in the dark, a figure appears, a door opens, someone speaks, something changes
- Bad endings: "you drift off to sleep", "ready for the journey ahead", "you settle in for the night"
- If the player rests or waits, something MUST interrupt or be discovered during that time`;
    } catch {}
  }

  return prompt;
}

module.exports = { getSystem, listSystems, buildDmPrompt, buildArcPrompt, SYSTEMS };
