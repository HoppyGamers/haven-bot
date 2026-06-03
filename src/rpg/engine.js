// ---------------------------------------------------------------------------
// src/rpg/engine.js
//
// Main RPG engine — handles message parsing, DM responses, and game state.
// ---------------------------------------------------------------------------

const { chat }         = require('../agent/ollama');
const { roll, formatRoll, abilityMod, formatMod, rollCharacterStats } = require('./dice');
const { buildDmPrompt, getSystem, listSystems } = require('./systems');
const { campaigns, characters, gameLog, combat, sessions, getDb } = require('./database');
const { generateAscii, formatAscii, getPrebuilt } = require('./ascii');

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

/**
 * Parse an incoming message to determine its type and intent.
 *
 * Types:
 *   'action'   — committed in-game move (starts with ACTION)
 *   'question' — OOC question to the DM
 *   'command'  — rpg management command (rpg setup, rpg join, etc.)
 *   'roll'     — dice roll request
 *   'ignore'   — not directed at the DM
 */
function parseMessage(content, agentName, userId) {
  const text    = content.trim();
  const dmName  = agentName.toLowerCase();
  const lower   = text.toLowerCase();

  // Must start with the DM's name to be relevant
  if (!lower.startsWith(dmName)) return { type: 'ignore' };

  // Strip the DM name prefix
  const body = text.slice(dmName.length).trim();

  // RPG management commands
  if (/^rpg\s+/i.test(body)) {
    const cmd = body.slice(4).trim();
    return { type: 'command', command: cmd };
  }

  // Dice roll
  if (/^roll\s+/i.test(body)) {
    const expr = body.slice(5).trim();
    return { type: 'roll', expression: expr };
  }

  // Committed ACTION
  if (/^action\s+/i.test(body)) {
    const action = body.slice(7).trim();
    return { type: 'action', content: action };
  }

  // OOC question or statement to DM
  if (body) {
    return { type: 'question', content: body };
  }

  return { type: 'ignore' };
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleCommand(bot, channelId, userId, username, command, agentConfig) {
  userId = String(userId); // Haven sends user_id as number, DB stores as TEXT
  const parts = command.trim().split(/\s+/);
  const cmd   = parts[0]?.toLowerCase();

  switch (cmd) {

    case 'setup': {
      // dmbob rpg setup <name> [system]
      // e.g. "dmbob rpg setup Curse of Strahd dnd5e"
      const systems   = listSystems().map(s => s.key);
      const lastPart  = parts[parts.length - 1]?.toLowerCase();
      const hasSystem = systems.includes(lastPart);
      const sysKey    = hasSystem ? lastPart : 'dnd5e';
      const nameParts = hasSystem ? parts.slice(1, -1) : parts.slice(1);
      const name      = nameParts.join(' ').trim();

      if (!name) {
        const { SYSTEMS } = require('./systems');
        const syslist = listSystems().map(s => {
          const sys = SYSTEMS[s.key];
          const classes = sys.classes.slice(0, 5).join(', ') + (sys.classes.length > 5 ? '...' : '');
          return `**\`${s.key}\`** — ${s.name}\n${s.description}\nClasses: ${classes}`;
        }).join('\n\n');
        return bot.sendMessage(
          `⚔️ **RPG Systems**\n\n${syslist}\n\n` +
          `**Usage:** \`${agentConfig.agentName} rpg setup <campaign name> <system>\`\n` +
          `**Example:** \`${agentConfig.agentName} rpg setup Curse of Strahd dnd5e\``
        );
      }

      const existing = campaigns.getByChannel(channelId);
      if (existing) {
        return bot.sendMessage(
          `⚔️ This channel already has a campaign: **${existing.name}**\n` +
          `Status: ${existing.status}`
        );
      }

      campaigns.create(channelId, name, sysKey, userId, username);
      const system = getSystem(sysKey);

      const classLines = system.classes.map(c => {
        const desc = system.classDescriptions?.[c] || '';
        return `  \`${c}\`${desc ? ' — ' + desc.split('.')[0] : ''}`;
      }).join('\n');

      const raceLines = system.races.map(r => {
        const desc = system.raceDescriptions?.[r] || '';
        return `  \`${r}\`${desc ? ' — ' + desc.split('.')[0] : ''}`;
      }).join('\n');

      return bot.sendMessage(
        `⚔️ **Campaign Created: ${name}**\n` +
        `📖 System: ${system.name} | 👑 DM: ${username}\n\n` +
        `**Available Classes:**\n${classLines}\n\n` +
        `**Available Races:**\n${raceLines}\n\n` +
        `Join with: \`${agentConfig.agentName} rpg join <character name> <class> <race>\`\n` +
        `Example: \`${agentConfig.agentName} rpg join Aesmodien Fighter Elf\`\n` +
        `When ready: \`${agentConfig.agentName} rpg start\``
      );
    }

    case 'join': {
      // dmbob rpg join <name> <class> <race>
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel. DM can create one with \`${agentConfig.agentName} rpg setup\``);

      const existing = characters.getByCampaignAndUser(campaign.id, userId);
      if (existing) return bot.sendMessage(`⚔️ You already have a character: **${existing.name}** (${existing.race} ${existing.class})`);

      const name     = parts[1];
      const charClass= parts[2] || 'Fighter';
      const race     = parts[3] || 'Human';

      if (!name) {
        return bot.sendMessage(`❌ **Usage:** \`${agentConfig.agentName} rpg join <character name> <class> <race>\``);
      }

      // Roll stats
      const stats = rollCharacterStats();
      const system = getSystem(campaign.system);
      const baseHp = system.classHp[charClass] || 8;
      const conMod = abilityMod(stats.con);
      const hp     = Math.max(1, baseHp + conMod);

      characters.create(campaign.id, userId, username, name, charClass, race, {
        str: stats.str, dex: stats.dex, con: stats.con,
        int: stats.int, wis: stats.wis, cha: stats.cha,
      });

      const char = characters.getByCampaignAndUser(campaign.id, userId);

      return bot.sendMessage(
        `⚔️ **${name}** has joined the party!\n\n` +
        `📋 **Character Sheet**\n` +
        `Race: ${race} | Class: ${charClass} | Level: 1\n` +
        `HP: ${hp}/${hp} | AC: ${10 + abilityMod(stats.dex)}\n\n` +
        `**Ability Scores:**\n` +
        `STR ${stats.str} (${formatMod(stats.str)}) | DEX ${stats.dex} (${formatMod(stats.dex)}) | CON ${stats.con} (${formatMod(stats.con)})\n` +
        `INT ${stats.int} (${formatMod(stats.int)}) | WIS ${stats.wis} (${formatMod(stats.wis)}) | CHA ${stats.cha} (${formatMod(stats.cha)})`
      );
    }

    case 'start': {
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel.`);
      if (campaign.dm_user_id !== userId) return bot.sendMessage(`❌ Only the DM can start the campaign.`);

      const party = characters.getParty(campaign.id);
      if (party.length === 0) return bot.sendMessage(`❌ No players have joined yet.`);

      campaigns.setStatus(campaign.id, 'active');
      const sessionId = sessions.start(campaign.id);

      // Generate opening scene from DM
      await bot.sendMessage(`_${agentConfig.agentName} is setting the scene..._`);

      const systemPrompt = buildDmPrompt(campaign, party);
      const response = await chat({
        ollamaUrl:    agentConfig.ollamaUrl,
        model:        agentConfig.ollamaModel,
        systemPrompt,
        messages:     [{ role: 'user', content: 'Begin the campaign. Set the opening scene vividly. Welcome the players and describe where they are and what they perceive.' }],
      });

      const cleanedOpen = cleanDmResponse(response);
      gameLog.add(campaign.id, 'dm', cleanedOpen, agentConfig.agentName, null, sessionId);
      await bot.sendMessage(`🎲 **${campaign.name}**\n\n${cleanedOpen}`);

      // Generate opening scene ASCII art
      try {
        const artSubject = campaign.scene?.slice(0, 80) || campaign.name;
        const art = await generateAscii(artSubject, agentConfig.ollamaUrl, agentConfig.ollamaModel, 'scene');
        if (art) await bot.sendMessage(formatAscii(art));
      } catch {}
      return;
    }

    case 'status': {
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel.`);

      const party   = characters.getParty(campaign.id);
      const combatState = combat.get(campaign.id);

      const partyLines = party.map(p => {
        const conds = JSON.parse(p.conditions || '[]');
        const hpBar = makeHpBar(p.hp_current, p.hp_max);
        return `**${p.name}** (${p.race} ${p.class} Lv${p.level}) ${hpBar} HP: ${p.hp_current}/${p.hp_max}${conds.length > 0 ? ` | ${conds.join(', ')}` : ''}`;
      });

      let statusMsg = `⚔️ **${campaign.name}** — ${campaign.status}\n\n`;
      statusMsg += `**Party (${party.length}):**\n${partyLines.join('\n') || 'Empty'}`;
      if (combatState) statusMsg += `\n\n⚔️ **IN COMBAT** — Round ${combatState.round}`;

      return bot.sendMessage(statusMsg);
    }

    case 'sheet': {
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel.`);

      const char = characters.getByCampaignAndUser(campaign.id, userId);
      if (!char) return bot.sendMessage(`❌ You don't have a character in this campaign. Join with \`${agentConfig.agentName} rpg join\``);

      const inv   = JSON.parse(char.inventory || '[]');
      const conds = JSON.parse(char.conditions || '[]');

      return bot.sendMessage(
        `📋 **${char.name}** — ${char.race} ${char.class} Level ${char.level}\n\n` +
        `❤️ HP: ${char.hp_current}/${char.hp_max} | 🛡️ AC: ${char.ac}\n\n` +
        `**Abilities:**\n` +
        `STR ${char.str} (${formatMod(char.str)}) | DEX ${char.dex} (${formatMod(char.dex)}) | CON ${char.con} (${formatMod(char.con)})\n` +
        `INT ${char.int} (${formatMod(char.int)}) | WIS ${char.wis} (${formatMod(char.wis)}) | CHA ${char.cha} (${formatMod(char.cha)})\n\n` +
        `🎒 **Inventory:** ${inv.length > 0 ? inv.join(', ') : 'Empty'}\n` +
        `⚡ **Conditions:** ${conds.length > 0 ? conds.join(', ') : 'None'}`
      );
    }

    case 'inventory': {
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel.`);
      const char = characters.getByCampaignAndUser(campaign.id, userId);
      if (!char) return bot.sendMessage(`❌ You don't have a character.`);
      const inv = JSON.parse(char.inventory || '[]');
      return bot.sendMessage(`🎒 **${char.name}'s Inventory:** ${inv.length > 0 ? inv.join(', ') : 'Empty'}`);
    }

    case 'pause': {
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel.`);
      if (campaign.dm_user_id !== userId) return bot.sendMessage(`❌ Only the DM can pause.`);
      campaigns.setStatus(campaign.id, 'paused');
      return bot.sendMessage(`⏸️ **${campaign.name}** paused. Resume with \`${agentConfig.agentName} rpg resume\``);
    }

    case 'resume': {
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel.`);
      if (campaign.dm_user_id !== userId) return bot.sendMessage(`❌ Only the DM can resume.`);
      campaigns.setStatus(campaign.id, 'active');
      return bot.sendMessage(`▶️ **${campaign.name}** resumed!`);
    }

    case 'recap': {
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel.`);

      const party   = characters.getParty(campaign.id);
      const recent  = gameLog.getRecent(campaign.id, 30);
      if (recent.length === 0) return bot.sendMessage(`📖 No events recorded yet.`);

      const logText = recent.map(l =>
        l.type === 'action' ? `${l.username}: ACTION — ${l.content}` :
        l.type === 'dm'     ? `DM: ${l.content}` :
        `${l.username}: ${l.content}`
      ).join('\n\n');

      await bot.sendMessage(`_${agentConfig.agentName} is writing the recap..._`);

      const systemPrompt = buildDmPrompt(campaign, party);
      const response = await chat({
        ollamaUrl:    agentConfig.ollamaUrl,
        model:        agentConfig.ollamaModel,
        systemPrompt,
        messages: [{
          role: 'user',
          content: `Write a dramatic "Previously on ${campaign.name}..." recap of these recent events. Make it engaging and 150-200 words:\n\n${logText}`
        }],
      });

      return bot.sendMessage(`📖 **Previously on ${campaign.name}...**\n\n${cleanDmResponse(response)}`);
    }

    case 'systems': {
      const { SYSTEMS } = require('./systems');
      const syslist = listSystems().map(s => {
        const sys = SYSTEMS[s.key];
        return `**\`${s.key}\`** — **${s.name}**\n${s.description}\n${sys.classes.length} classes available`;
      }).join('\n\n');
      return bot.sendMessage(
        `🎲 **Available RPG Systems:**\n\n${syslist}\n\n` +
        `Use \`${agentConfig.agentName} rpg setup <name> <system>\` to start a campaign.`
      );
    }

    case 'art': {
      const subject = parts.slice(1).join(' ').trim();
      if (!subject) return bot.sendMessage(`❌ **Usage:** \`${agentConfig.agentName} rpg art <subject>\`\nExample: \`${agentConfig.agentName} rpg art ancient dragon\``);
      await bot.sendMessage(`_Generating ASCII art..._`);
      const style = /map|dungeon|room|area/i.test(subject) ? 'map' :
                    /monster|creature|dragon|beast|enemy/i.test(subject) ? 'monster' :
                    /sword|shield|staff|item|weapon|armor/i.test(subject) ? 'item' : 'scene';
      try {
        const art = await generateAscii(subject, agentConfig.ollamaUrl, agentConfig.ollamaModel, style);
        if (art) return bot.sendMessage(formatAscii(art, subject));
        return bot.sendMessage(`❌ Could not generate art for: ${subject}`);
      } catch (err) {
        return bot.sendMessage(`❌ Art generation failed: ${err.message}`);
      }
    }

    case 'help': {
      return bot.sendMessage(
        `⚔️ **${agentConfig.agentName} RPG Commands**\n\n` +
        `**Setup:**\n` +
        `\`${agentConfig.agentName} rpg setup <name> [system]\` — create a campaign in this channel\n` +
        `\`${agentConfig.agentName} rpg join <name> <class> <race>\` — join with a character\n` +
        `\`${agentConfig.agentName} rpg start\` — begin the campaign (DM only)\n` +
        `\`${agentConfig.agentName} rpg systems\` — list available game systems\n\n` +
        `**During Play:**\n` +
        `\`${agentConfig.agentName} ACTION <what you do>\` — committed in-game action\n` +
        `\`${agentConfig.agentName} <question>\` — ask the DM out-of-character\n` +
        `\`${agentConfig.agentName} roll <dice>\` — roll dice (e.g. 1d20, 2d6+3, adv)\n\n` +
        `**Info:**\n` +
        `\`${agentConfig.agentName} rpg status\` — party HP and status\n` +
        `\`${agentConfig.agentName} rpg sheet\` — your character sheet\n` +
        `\`${agentConfig.agentName} rpg inventory\` — your inventory\n` +
        `\`${agentConfig.agentName} rpg recap\` — AI summary of recent events\n\n` +
        `**DM Only:**\n` +
        `\`${agentConfig.agentName} rpg pause / resume\` — freeze/unfreeze the game`
      );
    }

    case '':
    case undefined:
      return bot.sendMessage(
        `⚔️ **${agentConfig.agentName} RPG** — type \`${agentConfig.agentName} rpg help\` for commands.`
      );

    default:
      return bot.sendMessage(
        `❓ Unknown RPG command: \`${cmd}\`\n` +
        `Type \`${agentConfig.agentName} rpg help\` for available commands.`
      );
  }
}

// ---------------------------------------------------------------------------
// Action and question handlers
// ---------------------------------------------------------------------------

async function handleAction(bot, channelId, userId, username, actionText, agentConfig) {
  const campaign = campaigns.getByChannel(channelId);
  if (!campaign) return;
  if (campaign.status !== 'active') return;

  const char  = characters.getByCampaignAndUser(campaign.id, userId);
  const party = characters.getParty(campaign.id);

  // Log the action
  gameLog.add(campaign.id, 'action', actionText, username);

  // Check if a roll is needed — ask Ollama with the roll baked in
  // Determine appropriate roll based on action keywords
  const rollResult = inferRollFromAction(actionText, char);

  let rollInfo = '';
  if (rollResult) {
    const result = roll(rollResult.dice);
    rollInfo = `\n\n🎲 **${rollResult.label}:** ${rollResult.dice} → ${result.breakdown}`;
    await bot.sendMessage(`${username}: *${actionText}*${rollInfo}`);
    gameLog.add(campaign.id, 'roll', `${rollResult.label}: ${result.total}`, username, [result]);
  } else {
    await bot.sendMessage(`${username}: *${actionText}*`);
  }

  // Build context for DM
  const recent  = gameLog.getRecent(campaign.id, 15);
  const history = recent.map(l => ({
    role:    l.type === 'dm' ? 'assistant' : 'user',
    content: l.type === 'action'
      ? `[${l.username} ACTION]: ${l.content}${l.dice_rolls ? ' [Roll: ' + JSON.parse(l.dice_rolls)[0]?.total + ']' : ''}`
      : l.type === 'roll'
      ? `[${l.username} rolled]: ${l.content}`
      : cleanDmResponse(l.content),
  }));

  const userMsg = rollResult
    ? `[${username} ACTION]: ${actionText} [Roll result: ${roll(rollResult.dice).total}]`
    : `[${username} ACTION]: ${actionText}`;

  // Get DM response
  const systemPrompt = buildDmPrompt(campaign, party);
  const thinkingMsg  = await bot.sendMessage(`_${agentConfig.agentName} is narrating..._`);

  try {
    const response = await chat({
      ollamaUrl:    agentConfig.ollamaUrl,
      model:        agentConfig.ollamaModel,
      systemPrompt,
      messages:     [...history.slice(-10), { role: 'user', content: userMsg }],
      timeoutMs:    120000,
    });

    if (thinkingMsg?.message_id) {
      try { await bot.deleteMessage(thinkingMsg.message_id); } catch {}
    }

    const cleaned = cleanDmResponse(response);
    gameLog.add(campaign.id, 'dm', cleaned, agentConfig.agentName);

    // Update scene in DB with last DM narration
    campaigns.updateScene(campaign.id, cleaned.slice(0, 500));

    await bot.sendMessage(`⚔️ **${agentConfig.agentName}:** ${cleaned}`);

    // Generate ASCII art for significant scene moments
    const artTrigger = inferArtTrigger(cleaned);
    if (artTrigger) {
      try {
        const art = await generateAscii(artTrigger.subject, agentConfig.ollamaUrl, agentConfig.ollamaModel, artTrigger.style);
        if (art) await bot.sendMessage(formatAscii(art, artTrigger.label));
      } catch {}
    }

  } catch (err) {
    if (thinkingMsg?.message_id) {
      try { await bot.deleteMessage(thinkingMsg.message_id); } catch {}
    }
    await bot.sendMessage(`❌ DM encountered an error: ${err.message}`);
  }
}

async function handleQuestion(bot, channelId, userId, username, questionText, agentConfig) {
  const campaign = campaigns.getByChannel(channelId);
  if (!campaign) return;
  if (campaign.status === 'paused') {
    return bot.sendMessage(`⏸️ The campaign is paused.`);
  }

  const char  = characters.getByCampaignAndUser(campaign.id, userId);
  const party = characters.getParty(campaign.id);
  const recent = gameLog.getRecent(campaign.id, 10);

  const history = recent.map(l => ({
    role:    l.type === 'dm' ? 'assistant' : 'user',
    content: l.type === 'action' ? `[${l.username} ACTION]: ${l.content}` : cleanDmResponse(l.content),
  }));

  const systemPrompt = buildDmPrompt(campaign, party);

  const thinkingMsg = await bot.sendMessage(`_${agentConfig.agentName} is thinking..._`);

  try {
    const response = await chat({
      ollamaUrl:    agentConfig.ollamaUrl,
      model:        agentConfig.ollamaModel,
      systemPrompt,
      messages:     [...history.slice(-8), { role: 'user', content: `[${username} OOC]: ${questionText}` }],
      timeoutMs:    120000,
    });

    if (thinkingMsg?.message_id) {
      try { await bot.deleteMessage(thinkingMsg.message_id); } catch {}
    }

    await bot.sendMessage(`🎲 **${agentConfig.agentName}:** ${cleanDmResponse(response)}`);

  } catch (err) {
    if (thinkingMsg?.message_id) {
      try { await bot.deleteMessage(thinkingMsg.message_id); } catch {}
    }
    await bot.sendMessage(`❌ ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Infer what dice roll is needed based on action text and character.
 * Returns { dice, label } or null if no roll needed.
 */
function inferRollFromAction(actionText, char) {
  const text = actionText.toLowerCase();

  // Attack actions
  if (/attack|strike|slash|stab|shoot|fire|cast|hit/i.test(text)) {
    const mod = char ? abilityMod(char.str) + 2 : 2; // +2 proficiency
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    return { dice: `1d20${modStr}`, label: 'Attack Roll' };
  }

  // Stealth
  if (/sneak|hide|stealth|creep/i.test(text)) {
    const mod = char ? abilityMod(char.dex) : 0;
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    return { dice: `1d20${modStr}`, label: 'Stealth Check' };
  }

  // Persuasion/Deception
  if (/persuade|convince|lie|deceive|bluff|intimidate/i.test(text)) {
    const mod = char ? abilityMod(char.cha) : 0;
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    return { dice: `1d20${modStr}`, label: 'Charisma Check' };
  }

  // Perception/Investigation — only when actively searching or investigating
  if (/search|examine|investigate|listen carefully|spot|look for|look around|scout/i.test(text)) {
    const mod = char ? abilityMod(char.wis) : 0;
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    return { dice: `1d20${modStr}`, label: 'Perception Check' };
  }

  // Athletics — only clearly challenging physical feats, not casual actions
  if (/climb|jump|swim|sprint|force open|lift|break down|scale|vault/i.test(text)) {
    const mod = char ? abilityMod(char.str) : 0;
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    return { dice: `1d20${modStr}`, label: 'Athletics Check' };
  }

  // Acrobatics
  if (/dodge|tumble|flip|balance|acrobat/i.test(text)) {
    const mod = char ? abilityMod(char.dex) : 0;
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    return { dice: `1d20${modStr}`, label: 'Acrobatics Check' };
  }

  return null; // No roll needed
}

/**
 * Detect significant scene moments that warrant ASCII art.
 * Returns { subject, style, label } or null.
 */
function inferArtTrigger(dmText) {
  const text = dmText.toLowerCase();

  // Combat encounter — monster/enemy appears
  const monsterMatch = dmText.match(/(?:a|an|the)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:emerges|appears|attacks|lunges|charges|snarls|roars|steps out|bursts)/);
  if (monsterMatch) {
    return { subject: monsterMatch[1], style: 'monster', label: monsterMatch[1] };
  }

  // Entering a significant location
  const locationMatch = dmText.match(/(?:you enter|you step into|you arrive at|before you stands?|you find yourself in)\s+(?:a|an|the)\s+([^.,!?]{5,40})/i);
  if (locationMatch) {
    const loc = locationMatch[1].trim();
    if (/dungeon|cave|castle|tavern|forest|crypt|temple|tower|ruins|chamber/i.test(loc)) {
      return { subject: loc, style: 'scene', label: loc };
    }
  }

  // Dramatic reveal
  if (/massive|enormous|ancient|towering|crumbling|ominous|foreboding/i.test(text) &&
      /structure|building|creature|beast|door|gate|altar|throne/i.test(text)) {
    const words = dmText.split(/[.,!?]/)[0];
    if (words.length < 80) return { subject: words.trim(), style: 'scene', label: null };
  }

  return null;
}

/**
 * Strip Ollama's self-directed stage directions from DM responses.
 * Removes lines starting with "ACTION:", "NARRATOR:", etc.
 */
function cleanDmResponse(text) {
  return text
    // Remove full lines starting with stage direction keywords
    .split('\n')
    .filter(line => {
      const upper = line.trim().toUpperCase();
      return !upper.startsWith('ACTION:') &&
             !upper.startsWith('NARRATOR:') &&
             !upper.startsWith('DM:') &&
             !upper.startsWith('GAME MASTER:') &&
             !upper.startsWith('GM:') &&
             !upper.startsWith('* ACTION:') &&
             !upper.startsWith('- ACTION:');
    })
    .join('\n')
    // Remove inline ACTION: fragments that appear mid-text
    .replace(/\s*ACTION:\s*.*/gi, '')
    // Remove "Do you X?" meta prompts from the end
    .replace(/\s*(Do you|Would you like to|What would you like to|What do you do)[^.!?]*[.!?]\s*$/gi, '')
    .trim();
}

/**
 * Simple HP bar for status display.
 */
function makeHpBar(current, max) {
  const pct   = Math.max(0, current / max);
  const filled = Math.round(pct * 5);
  const bar    = '█'.repeat(filled) + '░'.repeat(5 - filled);
  const color  = pct > 0.5 ? '🟢' : pct > 0.25 ? '🟡' : '🔴';
  return `${color}[${bar}]`;
}

module.exports = { parseMessage, handleCommand, handleAction, handleQuestion };
