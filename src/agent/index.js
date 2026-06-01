// ---------------------------------------------------------------------------
// src/agent/index.js
//
// Agent entry point. Loaded only when AGENT_ENABLED=true.
// Stage 3A: registers the agent slash command and handles basic chat via Ollama.
// ---------------------------------------------------------------------------

const { getGlobalConfig, getChannelConfig, isEnabledForChannel } = require('./config');
const { chat, healthCheck } = require('./ollama');
const { initAgentDatabase, conversations } = require('./database');

let agentDb = null;

/**
 * Initialize the agent.
 * Called from src/index.js when AGENT_ENABLED=true.
 *
 * @param {object} bot           - Haven bot instance
 * @param {object} channelManager - Channel manager instance
 */
async function initAgent(bot, channelManager) {
  const config = getGlobalConfig();

  console.log(`🤖 Agent initializing...`);
  console.log(`   Name:    ${config.agentName}`);
  console.log(`   Command: /${config.agentCommand}`);
  console.log(`   Mode:    ${config.mode}`);
  console.log(`   Model:   ${config.ollamaModel}`);
  console.log(`   Ollama:  ${config.ollamaUrl}`);

  // Initialize agent database
  agentDb = initAgentDatabase();

  // Health check Ollama
  console.log(`   Checking Ollama...`);
  const health = await healthCheck(config.ollamaUrl, config.ollamaModel);
  if (!health.ok) {
    console.warn(`   ⚠️  Ollama unavailable: ${health.error}`);
    console.warn(`   Agent will start but responses will fail until Ollama is reachable.`);
  } else {
    console.log(`   ✅ Ollama ready`);
  }

  // Register the agent slash command on all configured channels
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

/**
 * Handle an incoming agent command.
 * Called from src/index.js when the agent command is received.
 *
 * @param {object} bot        - Haven bot instance (channel-scoped proxy)
 * @param {object} data       - Command data { command, user, user_id, channel_id, args }
 */
async function handleAgentCommand(bot, data) {
  const { user, user_id, channel_id, args } = data;
  const config = getChannelConfig(channel_id, agentDb);

  // Check if agent is enabled for this channel
  if (!isEnabledForChannel(channel_id, agentDb)) {
    return;
  }

  // Get the user's message from args
  const userMessage = args.join(' ').trim();

  if (!userMessage) {
    return bot.sendMessage(
      `👋 Hi ${user}! I'm ${config.agentName}. Ask me anything — try \`/${config.agentCommand} how many F1 races are left this season?\``
    );
  }

  // Add user message to conversation history
  conversations.add(channel_id, 'user', userMessage, user);
  conversations.trim(channel_id, config.historySize);

  // Build conversation history for Ollama
  const history = conversations.getHistory(channel_id, config.historySize);
  const messages = history.map(h => ({
    role:    h.role,
    content: h.username && h.role === 'user'
      ? `[${h.username}]: ${h.content}`
      : h.content,
  }));

  // Send typing indicator — let user know something is happening
  await bot.sendMessage(`_${config.agentName} is thinking..._`);

  try {
    const response = await chat({
      ollamaUrl:    config.ollamaUrl,
      model:        config.ollamaModel,
      systemPrompt: config.systemPrompt,
      messages,
    });

    if (!response || !response.trim()) {
      await bot.sendMessage(`❌ **${config.agentName}**: No response from model. Try again.`);
      return;
    }

    // Add assistant response to conversation history
    conversations.add(channel_id, 'assistant', response);
    conversations.trim(channel_id, config.historySize);

    // Send response — prefix with agent name for clarity in busy channels
    await bot.sendMessage(`**${config.agentName}:** ${response}`);

  } catch (err) {
    console.error(`[Agent] Error:`, err.message);
    await bot.sendMessage(
      `❌ **${config.agentName}** encountered an error: ${err.message}\n\n` +
      `Check that Ollama is running at \`${config.ollamaUrl}\`.`
    );
  }
}

/**
 * Check if a command matches the configured agent command.
 */
function isAgentCommand(command) {
  const config = getGlobalConfig();
  return command === config.agentCommand;
}

module.exports = { initAgent, handleAgentCommand, isAgentCommand };
