// ---------------------------------------------------------------------------
// Multi-channel manager
//
// Loads channels from two sources (merged at startup, DB takes precedence):
//   1. WEBHOOK_TOKENS env var — bootstrap channels, always loaded
//   2. bot_channels DB table — runtime-added channels via /addchannel
//
// WEBHOOK_TOKENS format: ChannelName:ChannelCode:Token,...
// ---------------------------------------------------------------------------

/**
 * Parse WEBHOOK_TOKENS env var into an array of { token, channelName, channelCode }.
 */
function parseTokenConfig() {
  const multi = process.env.WEBHOOK_TOKENS;

  if (multi && multi.trim()) {
    return multi.split(',').map(entry => {
      const parts = entry.trim().split(':');

      if (parts.length >= 3) {
        // New format: ChannelName:ChannelCode:Token
        return {
          channelName: parts[0].trim(),
          channelCode: parts[1].trim(),
          token:       parts[2].trim(),
          source:      'env',
        };
      } else if (parts.length === 2) {
        // Old format: Token:ChannelName
        return {
          token:       parts[0].trim(),
          channelName: parts[1].trim(),
          channelCode: null,
          source:      'env',
        };
      } else {
        return { token: parts[0].trim(), channelName: 'Unknown', channelCode: null, source: 'env' };
      }
    }).filter(e => e.token);
  }

  // Single-channel fallback
  const single = process.env.WEBHOOK_TOKEN;
  if (single) {
    return [{ token: single.trim(), channelName: process.env.BOT_NAME || 'General', channelCode: null, source: 'env' }];
  }

  return [];
}

class ChannelManager {
  constructor() {
    this.configs     = [];            // all channels: { token, channelName, channelCode, source }
    this.tokenByCode = new Map();     // channelCode → token
    this.nameByCode  = new Map();     // channelCode → channelName
    this.nameByToken = new Map();     // token → channelName
    this.primaryToken = null;

    // Load env channels first
    const envChannels = parseTokenConfig();
    for (const ch of envChannels) {
      this._addConfig(ch);
    }
    this.primaryToken = this.configs[0]?.token || null;

    // Pre-register channel codes from env
    this._preRegisterAll();
  }

  /**
   * Load additional channels from the database.
   * Called after DB is initialized in index.js.
   */
  loadFromDatabase() {
    try {
      const { botChannels } = require('./database');
      const dbChannels = botChannels.getAll();

      let added = 0;
      for (const ch of dbChannels) {
        // Skip if already registered from env (env takes precedence for bootstrap)
        if (this.tokenByCode.has(ch.channel_id)) continue;

        const config = {
          channelName: ch.channel_name,
          channelCode: ch.channel_id,
          token:       ch.token,
          source:      'db',
        };
        this._addConfig(config);
        this.tokenByCode.set(ch.channel_id, ch.token);
        this.nameByCode.set(ch.channel_id, ch.channel_name);
        this.nameByToken.set(ch.token, ch.channel_name);
        added++;
        console.log(`📌 DB channel loaded: ${ch.channel_name} (${ch.channel_id})`);
      }

      if (added > 0) console.log(`✅ Loaded ${added} channel(s) from database`);
    } catch (err) {
      // DB may not be ready yet on first run — that's ok
      console.warn(`[ChannelManager] Could not load DB channels: ${err.message}`);
    }
  }

  /**
   * Add a channel at runtime (no restart needed).
   * Saves to DB and registers immediately.
   */
  async addChannel(channelName, channelCode, token, addedBy, bot) {
    // Save to database
    const { botChannels } = require('./database');
    botChannels.add(channelCode, channelName, token, addedBy);

    // Register in memory
    const config = { channelName, channelCode, token, source: 'db' };
    this._addConfig(config);
    this.tokenByCode.set(channelCode, token);
    this.nameByCode.set(channelCode, channelName);
    this.nameByToken.set(token, channelName);

    console.log(`📌 Channel added at runtime: ${channelName} (${channelCode})`);

    // Register slash commands on new channel if bot provided
    if (bot) {
      await bot.registerAllCommandsOnChannel(channelCode, token);
    }

    return true;
  }

  /**
   * Remove a channel at runtime.
   */
  removeChannel(channelCode) {
    const { botChannels } = require('./database');
    const ch = botChannels.getById(channelCode);
    if (!ch) return false;

    botChannels.remove(channelCode);
    this.tokenByCode.delete(channelCode);
    this.nameByCode.delete(channelCode);
    this.configs = this.configs.filter(c => c.channelCode !== channelCode);

    console.log(`📌 Channel removed: ${channelCode}`);
    return true;
  }

  /**
   * Called when a callback arrives from a channel.
   */
  registerChannel(channelCode, token) {
    if (this.tokenByCode.has(channelCode)) return;
    if (!token) return;
    this.tokenByCode.set(channelCode, token);
    const name = this.nameByToken.get(token) || 'Unknown';
    this.nameByCode.set(channelCode, name);
    console.log(`📌 Channel registered: ${name} (${channelCode})`);
  }

  getToken(channelCode) {
    const token = this.tokenByCode.get(channelCode);
    if (!token) console.warn(`[ChannelManager] No token for channelCode: ${channelCode} — falling back to primary`);
    return token || this.primaryToken;
  }

  getChannelName(channelCode) {
    return this.nameByCode.get(channelCode) || channelCode;
  }

  getAllTokens() {
    return this.configs.filter(c => c.channelCode);
  }

  isMultiChannel() {
    return this.configs.length > 1;
  }

  getCallbackUrl(token) {
    const base = (process.env.CALLBACK_URL || '').replace(/\/$/, '');
    if (!base) return null;
    // For env-sourced channels use indexed paths; DB channels also get indexed
    const allConfigs = this.configs.filter(c => c.channelCode);
    if (allConfigs.length <= 1) return base + '/';
    const idx = allConfigs.findIndex(c => c.token === token);
    return idx >= 0 ? `${base}/cb/${idx + 1}` : `${base}/`;
  }

  getTokenByIndex(idx) {
    const allConfigs = this.configs.filter(c => c.channelCode);
    const config = allConfigs[idx - 1];
    return config ? config.token : null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _addConfig(config) {
    // Avoid duplicates
    if (config.channelCode && this.configs.some(c => c.channelCode === config.channelCode)) return;
    if (this.configs.some(c => c.token === config.token)) return;
    this.configs.push(config);
    if (config.token) this.nameByToken.set(config.token, config.channelName);
  }

  _preRegisterAll() {
    for (const config of this.configs) {
      if (config.channelCode) {
        this.tokenByCode.set(config.channelCode, config.token);
        this.nameByCode.set(config.channelCode, config.channelName);
        console.log(`📌 Pre-registered: ${config.channelName} (${config.channelCode})`);
      }
    }

    // Legacy WEBHOOK_CHANNEL_CODES fallback
    const codes = (process.env.WEBHOOK_CHANNEL_CODES || '').split(',').map(s => s.trim()).filter(Boolean);
    codes.forEach((code, idx) => {
      if (this.tokenByCode.has(code)) return;
      const config = this.configs[idx];
      if (config && code) {
        this.tokenByCode.set(code, config.token);
        this.nameByCode.set(code, config.channelName);
        console.log(`📌 Pre-registered: ${config.channelName} (${code})`);
      }
    });
  }
}

// Singleton
const channelManager = new ChannelManager();
module.exports = channelManager;
