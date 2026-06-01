// ---------------------------------------------------------------------------
// src/agent/index.js
//
// Agent entry point. Loaded only when AGENT_ENABLED=true.
// Stage 3B: adds persistent memory and recall to the 3A core.
// ---------------------------------------------------------------------------

const { getGlobalConfig, getChannelConfig, isEnabledForChannel } = require('./config');
const { chat, chatWithTools, healthCheck } = require('./ollama');
const { initAgentDatabase, conversations, memory, agentChannels } = require('./database');
const {
  detectRemember,
  detectRecall,
  rememberFact,
  getMemoryContext,
  formatMemoriesForDisplay,
} = require('./memory');
const { search, likelyNeedsSearch } = require('./search');
const { TOOL_DEFINITIONS, executeTool } = require('./tools');

let agentDb = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function initAgent(bot, channelManager) {
  const config = getGlobalConfig();

  console.log(`🤖 Agent initializing...`);
  console.log(`   Name:    ${config.agentName}`);
  console.log(`   Command: /${config.agentCommand}`);
  console.log(`   Mode:    ${config.mode}`);
  console.log(`   Model:   ${config.ollamaModel}`);
  console.log(`   Ollama:  ${config.ollamaUrl}`);

  agentDb = initAgentDatabase();

  console.log(`   Checking Ollama...`);
  const health = await healthCheck(config.ollamaUrl, config.ollamaModel);
  if (!health.ok) {
    console.warn(`   ⚠️  Ollama unavailable: ${health.error}`);
    console.warn(`   Agent will start but responses will fail until Ollama is reachable.`);
  } else {
    console.log(`   ✅ Ollama ready`);
  }

  // Health check SearXNG if configured
  if (config.searxngUrl) {
    const { healthCheck: searxCheck } = require('./search');
    const searxHealth = await searxCheck(config.searxngUrl);
    if (!searxHealth.ok) {
      console.warn(`   ⚠️  SearXNG unavailable: ${searxHealth.error}`);
    } else {
      console.log(`   ✅ SearXNG ready (${config.searxngUrl})`);
    }
  } else {
    console.log(`   ℹ️  SearXNG not configured — web search disabled`);
  }

  const allTokens = channelManager.getAllTokens();
  const description = `Chat with ${config.agentName} AI assistant`;

  for (const { token, channelName } of allTokens) {
    try {
      await bot.registerCommand(config.agentCommand, description, token);
      console.log(`   📌 /${config.agentCommand} registered on ${channelName}`);
    } catch (err) {
      console.error(`   ⚠️  Failed to register /${config.agentCommand} on ${channelName}:`, err.message);
    }
  }

  console.log(`✅ Agent ready — /${config.agentCommand} <message>`);
  return { agentDb };
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

async function handleAgentCommand(bot, data) {
  const { user, user_id, channel_id, args } = data;
  const config = getChannelConfig(channel_id, agentDb);

  if (!isEnabledForChannel(channel_id, agentDb)) return;

  const userMessage = args.join(' ').trim();

  if (!userMessage) {
    return bot.sendMessage(
      `👋 Hi ${user}! I'm ${config.agentName}. Ask me anything!\n` +
      `Try: \`/${config.agentCommand} how many F1 races are left this season?\`\n` +
      `Or: \`/${config.agentCommand} remember I prefer race results without spoilers\``
    );
  }

  // --- Handle help subcommand ---
  if (userMessage.toLowerCase() === 'help') {
    const agentHelpDeleteSecs = parseInt(process.env.HELP_DELETE_SECONDS || '0', 10);
    const agentHelpMsg = await bot.sendMessage(
      `🤖 **${config.agentName} — AI Agent Help**

` +
      `**Chat:**
` +
      `\`/${config.agentCommand} <message>\` - Ask anything

` +
      `**Memory:**
` +
      `\`/${config.agentCommand} remember <fact>\` - Store a fact permanently
` +
      `\`/${config.agentCommand} what do you know about me?\` - List stored memories
` +
      `\`/${config.agentCommand} forget everything about me\` - Clear your memories

` +
      `**Config (Admin Only):**
` +
      `\`/${config.agentCommand} config show\` - Current channel config
` +
      `\`/${config.agentCommand} config set-prompt "..."\` - Set custom persona
` +
      `\`/${config.agentCommand} config set-mode <mode>\` - command/mention/passive/active
` +
      `\`/${config.agentCommand} config set-name <name>\` - Rename agent for this channel
` +
      `\`/${config.agentCommand} config clear-history\` - Wipe conversation history
` +
      `\`/${config.agentCommand} config clear-memory\` - Wipe channel memory
` +
      `\`/${config.agentCommand} config enable/disable\` - Toggle agent in this channel
` +
      `\`/${config.agentCommand} config reset\` - Revert to global defaults`
    );
    if (agentHelpDeleteSecs > 0 && agentHelpMsg && agentHelpMsg.message_id) {
      setTimeout(async () => {
        try { await bot.deleteMessage(agentHelpMsg.message_id, channel_id); } catch {}
      }, agentHelpDeleteSecs * 1000);
    }
    return;
  }

  // --- Handle config subcommands (admin only) ---
  if (userMessage.startsWith('config ')) {
    return handleConfigCommand(bot, data, userMessage.slice(7).trim(), config);
  }

  // --- Handle remember requests ---
  const factToRemember = detectRemember(userMessage);
  if (factToRemember) {
    rememberFact('user', user_id.toString(), factToRemember);
    return bot.sendMessage(`🧠 **${config.agentName}:** Got it, I'll remember that.`);
  }

  // --- Handle recall requests ---
  const recallType = detectRecall(userMessage);
  if (recallType) {
    if (recallType === 'clear') {
      memory.clear('user', user_id.toString());
      return bot.sendMessage(`🧹 **${config.agentName}:** I've cleared everything I know about you.`);
    }
    const displayed = formatMemoriesForDisplay(
      user_id,
      recallType === 'channel' ? channel_id : channel_id
    );
    if (!displayed) {
      return bot.sendMessage(`🧠 **${config.agentName}:** I don't have any stored memories yet. Tell me something with \`remember...\``);
    }
    return bot.sendMessage(`🧠 **${config.agentName}:** Here's what I know:\n\n${displayed}`);
  }

  // --- Normal chat ---
  conversations.add(channel_id, 'user', userMessage, user);
  conversations.trim(channel_id, config.historySize);

  const history = conversations.getHistory(channel_id, config.historySize);
  const messages = history.map(h => ({
    role:    h.role,
    content: h.username && h.role === 'user'
      ? `[${h.username}]: ${h.content}`
      : h.content,
  }));

  // Inject persistent memory into system prompt
  const memoryContext = getMemoryContext(user_id, channel_id);
  let systemPrompt    = config.systemPrompt + memoryContext;

  // Add explicit tool use instruction to system prompt
  const currentYear = new Date().getFullYear();
  const toolInstruction = `\n\nIMPORTANT: You have access to tools. Use them immediately without asking for confirmation.\nThe current year is ${currentYear}. Always use ${currentYear} when the user does not specify a year.\n\nWhen to use each tool:\n- list_calendar_events: user asks about upcoming events or schedule\n- create_calendar_event: user asks to add/create/schedule an event — do it immediately, use year ${currentYear}\n- get_leaderboard: user asks about rankings, top users, XP standings\n- get_datetime: user asks about current time or date\n- play_sound: user asks to play a sound\n- list_rss_feeds: user asks about news feeds\n\nDo NOT ask for confirmation before calling a tool. Act immediately.`;
  systemPrompt = systemPrompt + toolInstruction;

  // Web search — run if SearXNG is configured and message likely needs current info
  let searchContext = '';
  if (config.searxngUrl && likelyNeedsSearch(userMessage)) {
    try {
      const { formatted } = await search(userMessage, config.searxngUrl, 5);
      if (formatted && formatted !== 'No search results found.') {
        searchContext = formatted;
        console.log(`[Agent] Search performed for: ${userMessage.slice(0, 60)}`);
      }
    } catch (err) {
      console.warn(`[Agent] Search failed: ${err.message}`);
    }
  }

  // Inject search results as additional context if available
  if (searchContext) {
    systemPrompt +=
      `\n\nWEB SEARCH RESULTS (current, real-time data — today is ${new Date().toDateString()}):\n` +
      `${searchContext}\n\n` +
      `IMPORTANT: Use the above search results to answer the question. ` +
      `These results are current and override your training data. ` +
      `If the results contain the answer, use them. Do not say you lack real-time data.`;
  }

  const thinkingMsg = await bot.sendMessage(`_${config.agentName} is thinking..._`);
  const thinkingId  = thinkingMsg?.message_id || null;

  const deleteThinking = async () => {
    if (thinkingId) {
      try { await bot.deleteMessage(thinkingId, channel_id); } catch {}
    }
  };

  try {
    // Use native tool calling
    const { content: firstContent, toolCalls } = await chatWithTools({
      ollamaUrl:    config.ollamaUrl,
      model:        config.ollamaModel,
      systemPrompt,
      messages,
      tools:        TOOL_DEFINITIONS,
    });


    let finalResponse = firstContent;

    // Execute tool calls if the model requested any
    if (toolCalls && toolCalls.length > 0) {
      const toolMessages = [...messages];

      if (firstContent) {
        toolMessages.push({ role: 'assistant', content: firstContent });
      }

      for (const tc of toolCalls) {
        console.log(`[Agent] Tool call: ${tc.name}`, tc.arguments);

        const toolResult = await executeTool(tc.name, tc.arguments, {
          bot,
          channelId: channel_id,
          userId:    user_id,
          username:  user,
          timezone:  process.env.TIMEZONE,
        });

        console.log(`[Agent] Tool result: ${toolResult.slice(0, 100)}`);

        // Add tool result to messages for follow-up
        toolMessages.push({
          role:    'tool',
          content: toolResult,
          name:    tc.name,
        });
      }

      // Get natural language response after tool execution
      const { content: followUpContent } = await chatWithTools({
        ollamaUrl:    config.ollamaUrl,
        model:        config.ollamaModel,
        systemPrompt,
        messages:     toolMessages,
        tools:        [],
      });

      finalResponse = followUpContent || firstContent;
    }

    await deleteThinking();

    if (!finalResponse || !finalResponse.trim()) {
      await bot.sendMessage(`❌ **${config.agentName}**: No response from model. Try again.`);
      return;
    }

    conversations.add(channel_id, 'assistant', finalResponse);
    conversations.trim(channel_id, config.historySize);

    await bot.sendMessage(`**${config.agentName}:** ${finalResponse}`);

  } catch (err) {
    await deleteThinking();
    console.error(`[Agent] Error:`, err.message);
    await bot.sendMessage(
      `❌ **${config.agentName}** encountered an error: ${err.message}\n\n` +
      `Check that Ollama is running at \`${config.ollamaUrl}\`.`
    );
  }
}

// ---------------------------------------------------------------------------
// Config subcommands (admin only)
// ---------------------------------------------------------------------------

async function handleConfigCommand(bot, data, subcommand, config) {
  const { user_id, channel_id } = data;

  // Simple admin check — uses the main bot's admin system
  const { admins } = require('../database');
  if (!admins.isAdmin(user_id.toString())) {
    return bot.sendMessage(`❌ **Permission Denied** — agent config commands are admin only.`);
  }

  const [action, ...rest] = subcommand.split(' ');
  const value = rest.join(' ').trim();

  switch (action) {
    case 'show': {
      const override = agentChannels.get(channel_id);
      return bot.sendMessage(
        `🤖 **Agent Config — ${config.agentName}**\n\n` +
        `Name: ${config.agentName}\n` +
        `Mode: ${config.mode}\n` +
        `Model: ${config.ollamaModel}\n` +
        `History size: ${config.historySize}\n` +
        `Channel override: ${override ? 'yes' : 'no (using global defaults)'}`
      );
    }

    case 'clear-history':
      conversations.clear(channel_id);
      return bot.sendMessage(`🧹 **${config.agentName}:** Conversation history cleared for this channel.`);

    case 'clear-memory':
      memory.clear('channel', channel_id);
      return bot.sendMessage(`🧹 **${config.agentName}:** Channel memory cleared.`);

    case 'set-prompt':
      if (!value) return bot.sendMessage(`❌ Usage: \`/${config.agentCommand} config set-prompt "Your prompt here"\``);
      agentChannels.set(channel_id, { system_prompt: value });
      return bot.sendMessage(`✅ System prompt updated for this channel.`);

    case 'set-mode':
      if (!['command', 'mention', 'passive', 'active'].includes(value)) {
        return bot.sendMessage(`❌ Valid modes: command, mention, passive, active`);
      }
      agentChannels.set(channel_id, { agent_mode: value });
      return bot.sendMessage(`✅ Mode set to \`${value}\` for this channel.`);

    case 'set-name':
      if (!value) return bot.sendMessage(`❌ Usage: \`/${config.agentCommand} config set-name <name>\``);
      agentChannels.set(channel_id, { agent_name: value });
      return bot.sendMessage(`✅ Agent name set to **${value}** for this channel.`);

    case 'reset':
      agentChannels.reset(channel_id);
      return bot.sendMessage(`✅ Channel config reset to global defaults.`);

    case 'enable':
      agentChannels.set(channel_id, { enabled: 1 });
      return bot.sendMessage(`✅ Agent enabled for this channel.`);

    case 'disable':
      agentChannels.set(channel_id, { enabled: 0 });
      return bot.sendMessage(`✅ Agent disabled for this channel.`);

    default:
      return bot.sendMessage(
        `🤖 **Agent Config Commands** (admin only)\n\n` +
        `\`/${config.agentCommand} config show\` — current config\n` +
        `\`/${config.agentCommand} config set-prompt "..."\` — set system prompt\n` +
        `\`/${config.agentCommand} config set-mode <mode>\` — command/mention/passive/active\n` +
        `\`/${config.agentCommand} config set-name <name>\` — set agent name\n` +
        `\`/${config.agentCommand} config clear-history\` — wipe conversation history\n` +
        `\`/${config.agentCommand} config clear-memory\` — wipe channel memory\n` +
        `\`/${config.agentCommand} config enable/disable\` — toggle agent\n` +
        `\`/${config.agentCommand} config reset\` — revert to global defaults`
      );
  }
}

// ---------------------------------------------------------------------------

function isAgentCommand(command) {
  const config = getGlobalConfig();
  return command === config.agentCommand;
}

module.exports = { initAgent, handleAgentCommand, isAgentCommand };