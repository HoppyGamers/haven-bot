// ---------------------------------------------------------------------------
// src/agent/config.js
//
// Resolves agent configuration for a given channel.
// Global defaults come from .env. Per-channel overrides are stored in
// haven-agent.db and completely replace the global values for that channel.
// ---------------------------------------------------------------------------

/**
 * Global agent config from environment variables.
 * All values can be overridden per-channel at runtime.
 */
function getGlobalConfig() {
  return {
    enabled:     (process.env.AGENT_ENABLED || 'false').toLowerCase() === 'true',
    agentName:   process.env.AGENT_NAME || 'Bob',
    agentCommand: process.env.AGENT_COMMAND || (process.env.AGENT_NAME || 'bob').toLowerCase(),
    mode:        process.env.AGENT_MODE || 'command',
    systemPrompt: process.env.AGENT_SYSTEM_PROMPT ||
      `You are ${process.env.AGENT_NAME || 'Bob'}, a helpful AI assistant for the Haven voice chat server. ` +
      `You can answer questions and help users with the server. Be concise and friendly.`,
    cooldown:    parseInt(process.env.AGENT_COOLDOWN || '30', 10),
    historySize: parseInt(process.env.AGENT_HISTORY_SIZE || '20', 10),
    channels:    (process.env.AGENT_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean),
    ollamaUrl:   process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
    searxngUrl:  process.env.SEARXNG_URL || null,
  };
}

/**
 * Resolve config for a specific channel.
 * Per-channel overrides from DB replace global values.
 * Any null DB field falls back to the global default.
 */
function getChannelConfig(channelId, db) {
  const global = getGlobalConfig();

  if (!db) return global;

  const override = db.prepare(
    'SELECT * FROM agent_channels WHERE channel_id = ?'
  ).get(channelId);

  if (!override) return global;

  return {
    ...global,
    agentName:    override.agent_name    || global.agentName,
    agentCommand: override.agent_command || global.agentCommand,
    mode:         override.agent_mode    || global.mode,
    systemPrompt: override.system_prompt || global.systemPrompt,
    cooldown:     override.cooldown      ?? global.cooldown,
    enabled:      override.enabled === null ? global.enabled : Boolean(override.enabled),
  };
}

/**
 * Check if the agent is enabled for a given channel.
 * Respects both global enabled flag and channel-level override.
 * Also checks AGENT_CHANNELS filter if configured.
 */
function isEnabledForChannel(channelId, db) {
  const global = getGlobalConfig();
  if (!global.enabled) return false;

  // Channel filter — if set, only respond in listed channels
  if (global.channels.length > 0 && !global.channels.includes(channelId)) {
    return false;
  }

  const config = getChannelConfig(channelId, db);
  return config.enabled;
}

module.exports = { getGlobalConfig, getChannelConfig, isEnabledForChannel };
