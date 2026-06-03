// ---------------------------------------------------------------------------
// src/rpg/engine.js
//
// Main RPG engine — handles message parsing, DM responses, and game state.
// ---------------------------------------------------------------------------

const { chat }         = require('../agent/ollama');
const { roll, formatRoll, abilityMod, formatMod, rollCharacterStats } = require('./dice');
const { buildDmPrompt, buildArcPrompt, getSystem, listSystems } = require('./systems');
const { campaigns, characters, gameLog, combat, sessions, getDb } = require('./database');

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

      // Step 1: Generate hidden campaign arc
      await bot.sendMessage(`_${agentConfig.agentName} is preparing the campaign..._`);
      try {
        const arcPrompt = buildArcPrompt(campaign, party);
        const arcRaw = await chat({
          ollamaUrl:    agentConfig.ollamaUrl,
          model:        agentConfig.ollamaModel,
          systemPrompt: 'You are a creative RPG game designer. Respond only with valid JSON, no other text, no markdown.',
          messages:     [{ role: 'user', content: arcPrompt }],
          timeoutMs:    120000,
        });
        const arcClean = arcRaw.replace(/```json|```/g, '').trim();
        const arcObj = JSON.parse(arcClean);
        const firstBeat = arcObj.acts?.[0]?.key_beats?.[0] || '';
        campaigns.updateArc(campaign.id, JSON.stringify(arcObj), 1, firstBeat);
        console.log(`[RPG] Arc generated for "${campaign.name}"`);
      } catch (err) {
        console.warn('[RPG] Arc generation failed, continuing without arc:', err.message);
      }

      // Step 2: Generate opening scene using arc context
      await bot.sendMessage(`_${agentConfig.agentName} is setting the scene..._`);

      const campaignWithArc = campaigns.getByChannel(channelId);
      const systemPrompt = buildDmPrompt(campaignWithArc, party);
      const response = await chat({
        ollamaUrl:    agentConfig.ollamaUrl,
        model:        agentConfig.ollamaModel,
        systemPrompt,
        messages:     [{ role: 'user', content: 'Begin the campaign. Set the opening scene for Act 1. Be atmospheric and introduce the initial hook naturally. Do not reveal the full plot.' }],
        timeoutMs:    120000,
      });

      const cleanedOpen = cleanDmResponse(response);
      gameLog.add(campaign.id, 'dm', cleanedOpen, agentConfig.agentName, null, sessionId);
      await bot.sendMessage(`🎲 **${campaign.name}**\n\n${cleanedOpen}`);

      // Generate opening scene image non-blocking
      if (process.env.COMFYUI_URL && process.env.IMAGE_BASE_URL) {
        generateImage(`${campaign.name} opening scene, ${campaignWithArc.scene?.slice(0, 80) || ''}`, 'scene')
          .then(url => { if (url) bot.sendMessage(url, channelId); })
          .catch(() => {});
      }

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

    case 'arc': {
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel.`);
      if (campaign.dm_user_id !== userId) return bot.sendMessage(`❌ Only the DM can view the arc.`);
      if (!campaign.arc) return bot.sendMessage(`📖 No arc yet — start the campaign with \`${agentConfig.agentName} rpg start\``);
      try {
        const arc = JSON.parse(campaign.arc);
        const actLines = arc.acts.map(a =>
          `${a.act === campaign.current_act ? '▶️' : '   '} **Act ${a.act}: ${a.title}**\n    ${a.summary}`
        ).join('\n');
        return bot.sendMessage(
          `📖 **${campaign.name} — Story Arc** *(DM Eyes Only)*\n\n` +
          `**Premise:** ${arc.premise}\n` +
          `**Villain:** ${arc.villain}\n` +
          `**Twist:** ${arc.twist}\n\n` +
          `**Acts:**\n${actLines}\n\n` +
          `**Current beat:** ${campaign.current_beat || '—'}\n` +
          `**Ending:** ${arc.ending}`
        );
      } catch {
        return bot.sendMessage(`❌ Could not read arc data.`);
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
        `\`${agentConfig.agentName} rpg pause / resume\` — freeze/unfreeze the game\n` +
        `\`${agentConfig.agentName} rpg arc\` — view the hidden campaign story arc\n` +
        `\`${agentConfig.agentName} rpg art <subject>\` — generate ASCII art`
      );
    }

    case 'delete': {
      const campaign = campaigns.getByChannel(channelId);
      if (!campaign) return bot.sendMessage(`❌ No campaign in this channel.`);
      if (campaign.dm_user_id !== userId) return bot.sendMessage(`❌ Only the DM can delete the campaign.`);

      const confirm = parts[1]?.toLowerCase();
      if (confirm !== 'confirm') {
        return bot.sendMessage(
          `⚠️ **Delete Campaign: ${campaign.name}**\n\n` +
          `This will permanently delete the campaign, all characters, and the entire game log.\n\n` +
          `To confirm: \`${agentConfig.agentName} rpg delete confirm\``
        );
      }

      // Delete all campaign data
      const db = getDb();
      db.prepare('DELETE FROM combat    WHERE campaign_id = ?').run(campaign.id);
      db.prepare('DELETE FROM game_log  WHERE campaign_id = ?').run(campaign.id);
      db.prepare('DELETE FROM sessions  WHERE campaign_id = ?').run(campaign.id);
      db.prepare('DELETE FROM characters WHERE campaign_id = ?').run(campaign.id);
      db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign.id);

      return bot.sendMessage(`🗑️ Campaign **${campaign.name}** has been deleted.`);
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
