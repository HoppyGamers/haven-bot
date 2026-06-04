// ---------------------------------------------------------------------------
// src/rpg/engine.js
//
// Main RPG engine — handles message parsing, DM responses, and game state.
// ---------------------------------------------------------------------------

const { chat }         = require('../agent/ollama');
const { roll, formatRoll, abilityMod, formatMod, rollCharacterStats } = require('./dice');
const { buildDmPrompt, buildArcPrompt, getSystem, listSystems } = require('./systems');
const { campaigns, characters, gameLog, combat, sessions, getDb } = require('./database');
const { generateImage, shouldGenerateImage, shouldGenerateAppearanceImage } = require('./images');

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
          numPredict:   4000,
        });
        // Extract JSON object from response — model sometimes adds text before or after
        let arcClean = arcRaw.replace(/```json|```/g, '').trim();
        const jsonStart = arcClean.indexOf('{');
        const jsonEnd   = arcClean.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          arcClean = arcClean.slice(jsonStart, jsonEnd + 1);
        }

        // Attempt JSON parse — if truncated, try to repair by closing open structures
        let arcObj;
        try {
          arcObj = JSON.parse(arcClean);
        } catch (parseErr) {
          console.log('[RPG] Parse error at:', parseErr.message);
          // Try to repair truncated JSON by closing unclosed structures
          let repaired = arcClean;
          // Close any unclosed string
          const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
          if (quoteCount % 2 !== 0) repaired += '"';
          // Close unclosed arrays and objects
          const opens  = (repaired.match(/[{[]/g) || []).length;
          const closes = (repaired.match(/[}\]]/g) || []).length;
          for (let i = 0; i < opens - closes; i++) repaired += i % 2 === 0 ? '}' : ']';
          repaired += ']}'; // close acts array and root object
          try { arcObj = JSON.parse(repaired); } catch { throw new Error('JSON repair failed'); }
        }

        // Normalize schema — accept both old (summary/key_beats) and new (beat/next) formats
        if (arcObj.acts) {
          arcObj.acts = arcObj.acts.map(a => ({
            act:   a.act,
            title: a.title || `Act ${a.act}`,
            beat:  a.beat || a.summary || (a.key_beats?.[0]) || '',
            next:  a.next || a.clues?.[0] || '',
          }));
        }

        const firstBeat = arcObj.acts?.[0]?.beat || '';
        campaigns.updateArc(campaign.id, JSON.stringify(arcObj), 1, firstBeat);
        console.log(`[RPG] Arc generated for "${campaign.name}" (${arcObj.acts?.length || 0} acts)`);
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
        messages:     [{ role: 'user', content: 'Begin the campaign in English only. Set the opening scene for Act 1. Be atmospheric and introduce the initial hook. Keep it under 150 words. Use double line breaks between paragraphs.' }],
        numPredict:   1200,
        timeoutMs:    120000,
      });

      const cleanedOpen = truncateDmResponse(cleanDmResponse(response), 200);
      gameLog.add(campaign.id, 'dm', cleanedOpen, agentConfig.agentName, null, sessionId);
      await bot.sendMessage(`🎲 **${campaign.name}**\n\n${cleanedOpen}`);

      // Generate opening scene image non-blocking
      if (process.env.COMFYUI_URL && process.env.IMAGE_BASE_URL) {
        const scenePrompt = cleanedOpen.split(/[.!?]/)[0].slice(0, 100).trim();
        const campSeed    = Math.abs((campaign.id * 2654435761) ^ (campaign.name.split('').reduce((a,c) => a + c.charCodeAt(0), 0) * 1234567)) % 2147483647; // deterministic seed per campaign
        console.log(`[RPG Images] Generating opening scene: ${scenePrompt.slice(0, 50)}...`);
        generateImage(`${campaign.system} RPG scene, ${scenePrompt}`, 'scene', campSeed)
          .then(url => {
            if (url) {
              console.log(`[RPG Images] Generated: ${url}`);
              bot.sendMessage(url, channelId);
            } else {
              console.warn('[RPG Images] No URL returned');
            }
          })
          .catch(err => console.warn('[RPG Images] Opening scene failed:', err.message));
      } else {
        console.log(`[RPG Images] Skipped — COMFYUI_URL not set`);

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

  // Check if a roll is needed — roll once and use that result everywhere
  const rollResult = inferRollFromAction(actionText, char);

  let rollInfo = '';
  let rolledTotal = null;
  if (rollResult) {
    const result = roll(rollResult.dice);
    rolledTotal  = result.total;
    rollInfo     = `\n\n🎲 **${rollResult.label}:** ${rollResult.dice} → ${result.breakdown}`;
    await bot.sendMessage(`${username}: *${actionText}*${rollInfo}`);
    gameLog.add(campaign.id, 'roll', `${rollResult.label}: ${result.total}`, username, [result]);
  } else {
    await bot.sendMessage(`${username}: *${actionText}*`);
  }

  // Log action now — after display but before history so it isn't double-sent to Ollama
  gameLog.add(campaign.id, 'action', actionText, username);

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

  // Inject roll result forcefully so Ollama never asks player to roll again
  const userMsg = rolledTotal !== null
    ? `[${username} ACTION]: ${actionText}\n[SYSTEM: The dice have already been rolled. ${rollResult.label} result = ${rolledTotal}. Use this exact number — do NOT ask the player to roll again.]`
    : `[${username} ACTION]: ${actionText}`;

  // Get DM response
  const systemPrompt = buildDmPrompt(campaign, party);
  const thinkingMsg  = await bot.sendMessage(`_${agentConfig.agentName} is narrating..._`);

  try {
    const response = await chat({
      ollamaUrl:    agentConfig.ollamaUrl,
      model:        agentConfig.ollamaModel,
      systemPrompt,
      messages:     [...history.slice(-10), { role: 'user', content: userMsg + '\n[Respond in English only. Use double line breaks between paragraphs. Maximum 3 paragraphs.]' }],
      numPredict:   1200,
      timeoutMs:    120000,
    });

    if (thinkingMsg?.message_id) {
      try { await bot.deleteMessage(thinkingMsg.message_id); } catch {}
    }

    const rawCleaned = cleanDmResponse(response);
    const cleaned    = truncateDmResponse(rawCleaned, 180);
    gameLog.add(campaign.id, 'dm', cleaned, agentConfig.agentName);

    // Update scene in DB with last DM narration
    campaigns.updateScene(campaign.id, cleaned.slice(0, 500));

    await bot.sendMessage(`⚔️ **${agentConfig.agentName}:** ${cleaned}`);

    // Detect dead endings — only if response wasn't truncated (truncation means Ollama was heading somewhere)
    if (rawCleaned.split(/\s+/).length <= 185 && isDeadEnding(cleaned)) {
      try {
        const interruptRaw = await chat({
          ollamaUrl:    agentConfig.ollamaUrl,
          model:        agentConfig.ollamaModel,
          systemPrompt: buildDmPrompt(campaign, party),
          messages:     [
            { role: 'assistant', content: cleaned },
            { role: 'user', content: '[SYSTEM: The scene needs a hook. Write exactly 1 sentence in English describing an unexpected interruption or event. Do NOT ask what the player does. Do NOT end with a question. Just describe what happens.]' }
          ],
          numPredict:   150,
          timeoutMs:    60000,
        });
        const interrupt = cleanDmResponse(interruptRaw).trim();
        if (interrupt && interrupt.length > 10) {
          gameLog.add(campaign.id, 'dm', interrupt, agentConfig.agentName);
          await bot.sendMessage(`⚔️ ${interrupt}`);
        }
      } catch {} // non-critical — don't fail the action if this errors
    }

    // Generate image for significant scene moments or appearance queries
    if (process.env.COMFYUI_URL && process.env.IMAGE_BASE_URL) {
      const campSeed = Math.abs((campaign.id * 2654435761) ^ (campaign.name.split('').reduce((a,c) => a + c.charCodeAt(0), 0) * 1234567)) % 2147483647;

      // Check if player asked about appearance (triggers immediately, not from DM text)
      const appearTrigger = shouldGenerateAppearanceImage(actionText, campaign.system);
      if (appearTrigger) {
        console.log(`[RPG Images] Generating appearance image: ${appearTrigger.prompt.slice(0, 50)}...`);
        generateImage(appearTrigger.prompt, appearTrigger.style, campSeed)
          .then(url => {
            if (url) { console.log(`[RPG Images] Generated: ${url}`); bot.sendMessage(url, channelId); }
          })
          .catch(err => console.warn('[RPG Images] Appearance image failed:', err.message));
      } else {
        // Check DM narration for scene/monster triggers
        const imgTrigger = shouldGenerateImage(cleaned, campaign.system, channelId);
        if (imgTrigger) {
          console.log(`[RPG Images] Generating action image: ${imgTrigger.prompt.slice(0, 50)}...`);
          generateImage(imgTrigger.prompt, imgTrigger.style, campSeed)
            .then(url => {
              if (url) { console.log(`[RPG Images] Generated: ${url}`); bot.sendMessage(url, channelId); }
            })
            .catch(err => console.warn('[RPG Images] Action image failed:', err.message));
        }
      }
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
      messages:     [...history.slice(-8), { role: 'user', content: `[OUT OF CHARACTER QUESTION — respond in English only, maximum 2 sentences, do NOT narrate any new events, do NOT advance the story, do NOT use the player's answer to continue the scene — just answer this question factually]: ${questionText}` }],
      numPredict:   400,
      timeoutMs:    120000,
    });

    if (thinkingMsg?.message_id) {
      try { await bot.deleteMessage(thinkingMsg.message_id); } catch {}
    }

    const answer = truncateDmResponse(cleanDmResponse(response), 80);
    await bot.sendMessage(`🎲 **${agentConfig.agentName}:** ${answer}`);

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
 * Returns { dice, label, type } or null if no roll needed.
 * type: 'attack' | 'defence' | 'skill' | 'initiative' | 'save'
 */
function inferRollFromAction(actionText, char) {
  const text = actionText.toLowerCase();

  const strMod  = char ? abilityMod(char.str)  : 0;
  const dexMod  = char ? abilityMod(char.dex)  : 0;
  const conMod  = char ? abilityMod(char.con)  : 0;
  const intMod  = char ? abilityMod(char.int)  : 0;
  const wisMod  = char ? abilityMod(char.wis)  : 0;
  const chaMod  = char ? abilityMod(char.cha)  : 0;
  const prof    = 2;
  const fmt     = n => n >= 0 ? `+${n}` : `${n}`;

  // Initiative
  if (/\binitiative\b|roll.*init/i.test(text)) {
    return { dice: `1d20${fmt(dexMod)}`, label: 'Initiative', type: 'initiative' };
  }

  // Defence / Parry / Block — must come before attack to avoid misclassification
  if (/\bdefend\b|\bparry\b|\bblock\b|\bshield\b.*block|\bevade\b|\bdive.*away\b|\broll.*away\b/i.test(text)) {
    return { dice: `1d20${fmt(dexMod)}`, label: 'Defence Roll', type: 'defence' };
  }

  // Ranged attack
  if (/shoot|fire.*arrow|fire.*bolt|throw.*javelin|throw.*dagger|loose.*arrow|fire.*crossbow/i.test(text)) {
    return { dice: `1d20${fmt(dexMod + prof)}`, label: 'Ranged Attack', type: 'attack' };
  }

  // Hacking / tech bypass
  if (/\bbypass\b|\bhack\b|\bcrack\b|\bpick.*lock|\bpicklock\b|\bdisable.*security|\boverride\b|\bsplice\b|\bnetrun\b/i.test(text)) {
    return { dice: `1d20${fmt(intMod + prof)}`, label: 'Hacking Check', type: 'skill' };
  }

  // Spell attack
  if (/\bcast\b|\bspell\b|fireball|lightning bolt|magic missile|\bchannel\b|eldritch blast/i.test(text)) {
    return { dice: `1d20${fmt(intMod + prof)}`, label: 'Spell Attack', type: 'attack' };
  }

  // Melee attack
  if (/\battack\b|\bstrike\b|\bslash\b|\bstab\b|\bswing\b|\bhit\b|\blunge\b|\bthrust\b|\bcut\b|\bchop\b|\bsmash\b|\bpunch\b|\bkick\b/i.test(text)) {
    return { dice: `1d20${fmt(strMod + prof)}`, label: 'Attack Roll', type: 'attack' };
  }

  // Stealth
  if (/\bsneak\b|\bhide\b|\bstealth\b|\bcreep\b|\bconceal\b|\bshadow\b/i.test(text)) {
    return { dice: `1d20${fmt(dexMod)}`, label: 'Stealth Check', type: 'skill' };
  }

  // Persuasion
  if (/\bpersuade\b|\bnegotiate\b|\bconvince\b|\bcharm\b|\bflatter\b|\bappeal\b/i.test(text)) {
    return { dice: `1d20${fmt(chaMod)}`, label: 'Persuasion Check', type: 'skill' };
  }

  // Deception
  if (/\blie\b|\bdeceive\b|\bbluff\b|\btrick\b|\bpretend\b|\bdisguise\b/i.test(text)) {
    return { dice: `1d20${fmt(chaMod)}`, label: 'Deception Check', type: 'skill' };
  }

  // Intimidation
  if (/\bintimidate\b|\bthreaten\b|\bmenace\b|\bscare\b|\bterrorize\b/i.test(text)) {
    return { dice: `1d20${fmt(chaMod)}`, label: 'Intimidation Check', type: 'skill' };
  }

  // Perception / Investigation
  if (/\bsearch\b|\bexamine\b|\binvestigate\b|\blisten\b|\bspot\b|\blook for\b|\bscout\b|\bdetect\b|\bsense\b|\bstudy\b/i.test(text)) {
    return { dice: `1d20${fmt(wisMod)}`, label: 'Perception Check', type: 'skill' };
  }

  // Athletics
  if (/\bclimb\b|\bjump\b|\bswim\b|\bsprint\b|force open|break down|\bscale\b|\bvault\b|\bgrapple\b|\bwrestle\b|\bshove\b/i.test(text)) {
    return { dice: `1d20${fmt(strMod)}`, label: 'Athletics Check', type: 'skill' };
  }

  // Acrobatics
  if (/\btumble\b|\bflip\b|\bbalance\b|\bsomersault\b|roll.*clear/i.test(text)) {
    return { dice: `1d20${fmt(dexMod)}`, label: 'Acrobatics Check', type: 'skill' };
  }

  // Constitution save
  if (/\bresist\b|\bendure\b|saving throw|constitution check|hold.*breath/i.test(text)) {
    return { dice: `1d20${fmt(conMod)}`, label: 'Constitution Save', type: 'save' };
  }

  return null; // No roll needed
}

/**
 * Hard truncate DM response to max word count at a sentence boundary.
 * Prevents Ollama from narrating the entire scene when it ignores length instructions.
 */
function truncateDmResponse(text, maxWords = 180) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();

  // Find the last sentence boundary within the word limit
  const truncated = words.slice(0, maxWords).join(' ');
  const lastSentence = truncated.search(/[.!?][^.!?]*$/);

  if (lastSentence > 50) {
    // Cut at last complete sentence
    return truncated.slice(0, lastSentence + 1).trim();
  }

  // No sentence boundary found — cut at word limit with ellipsis
  return truncated + '...';
}

/**
 * Detect if a DM response ends without a hook — no tension, no decision point.
 * Returns true if the scene needs an interrupt injected.
 */
function isDeadEnding(text) {
  const last = text.trim().split(/[.!?]/).filter(s => s.trim().length > 0).slice(-2).join(' ').toLowerCase();

  // Dead ending patterns — scene is closed with no hook
  const deadPatterns = [
    /ready (for|to) (whatever|the|your|what)/,
    /drift(s|ed)? (off |into )?to? sleep/,
    /settle(s|d)? (in|down|into)/,
    /wait(s|ing)? (to see|for|patiently)/,
    /prepare(s|d)? (yourself|themselves|for)/,
    /rest(s|ed|ing)? (for|until|through)/,
    /close(s|d)? (your|their|his|her) eyes/,
    /fade(s|d)? (to|into) (black|sleep|rest)/,
    /morning (comes|will come|arrives)/,
    /journey (ahead|continues|awaits)/,
    /whatever (comes|happens) next/,
    /lull(s|ed)? (you|them) to sleep/,
    /end(s|ed)? (the|your) (day|night|session)/,
    /time (will|to) tell/,
    // Question endings — DM asking player what to do instead of creating tension
    /what (do|does|will|should|would) (you|brock|the party) (do|choose|decide|want)/i,
    /which (path|way|door|option|choice) (do|will|should) (you|he|she|they)/i,
    /what (is|are) (your|brock.s) next (move|step|action)/i,
    /do you (want|wish|choose|decide)/i,
  ];

  return deadPatterns.some(p => p.test(last));
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
    // Remove meta prompts in English or other languages at the end
    .replace(/\s*(Do you|Would you like to|What would you like to|What do you do|Please ask|请问|接下来|— 请|—请)[^\n]*$/gim, '')
    // Strip [SYSTEM:...] tags that leak into DM narration
    .replace(/\[SYSTEM:[^\]]*\]/g, '')
    // Remove lines starting with — (DM stage direction bullets)
    .replace(/^\s*[—–-]\s*(Boorder|Player|Please|请|接)[^\n]*/gim, '')
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
