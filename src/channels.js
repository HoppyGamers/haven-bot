// ---------------------------------------------------------------------------
// Multi-channel manager
//
// Parses WEBHOOK_TOKENS from .env and manages the token→channel mapping.
// Falls back to single WEBHOOK_TOKEN for backward compatibility.
//
// WEBHOOK_TOKENS format:
//   token1:General,token2:Gaming,token3:World of Warcraft
// ---------------------------------------------------------------------------

/**
 * Parse WEBHOOK_TOKENS env var into an array of { token, channelName, channelCode } objects.
 *
 * Supported formats:
 *   New: ChannelName:ChannelCode:Token,ChannelName:ChannelCode:Token
 *   Old: Token:ChannelName,Token:ChannelName  (still supported)
 *
 * Falls back to WEBHOOK_TOKEN for single-channel setups.
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
        };
      } else if (parts.length === 2) {
        // Old format: Token:ChannelName
        return {
          token:       parts[0].trim(),
          channelName: parts[1].trim(),
          channelCode: null,
        };
      } else {
        return { token: parts[0].trim(), channelName: 'Unknown', channelCode: null };
      }
    }).filter(e => e.token);
  }

  // Single-channel fallback
  const single = process.env.WEBHOOK_TOKEN;
  if (single) {
    return [{ token: single.trim(), channelName: process.env.BOT_NAME || 'General', channelCode: null }];
  }

  return [];
}

class ChannelManager {
  constructor() {
    this.configs = parseTokenConfig();  // [{ token, channelName }]
    this.tokenByCode = new Map();       // channelCode → token
    this.nameByCode  = new Map();       // channelCode → channelName
    this.nameByToken = new Map();       // token → channelName
    this.primaryToken = this.configs[0]?.token || null;

    // Pre-populate token→name map
    for (const { token, channelName } of this.configs) {
      this.nameByToken.set(token, channelName);
    }

    // Pre-register channel codes immediately if configured
    this.preRegisterFromEnv();
  }

  /**
   * Called when we receive a callback from a channel.
   * Associates the channelCode with the correct token by matching
   * the token that Haven used to POST the callback.
   *
   * Haven includes the token in the webhook URL path, but the callback
   * payload doesn't include it — so we derive the association the first
   * time we see a channelCode by finding which token's webhook URL
   * matches the request path.
   */
  registerChannel(channelCode, token) {
    // If already pre-registered from env, don't overwrite with runtime discovery
    if (this.tokenByCode.has(channelCode)) return;
    if (!token) return;
    this.tokenByCode.set(channelCode, token);
    const name = this.nameByToken.get(token) || 'Unknown';
    this.nameByCode.set(channelCode, name);
    console.log(`📌 Channel registered: ${name} (${channelCode})`);
  }

  /**
   * Get the webhook token for sending to a specific channel.
   */
  getToken(channelCode) {
    const token = this.tokenByCode.get(channelCode);
    if (!token) console.warn(`[ChannelManager] No token for channelCode: ${channelCode} — falling back to primary`);
    return token || this.primaryToken;
  }

  /**
   * Get the friendly name for a channel code.
   */
  getChannelName(channelCode) {
    return this.nameByCode.get(channelCode) || channelCode;
  }

  /**
   * Get all configured tokens.
   */
  getAllTokens() {
    return this.configs;
  }

  /**
   * True if multiple channels are configured.
   */
  isMultiChannel() {
    return this.configs.length > 1;
  }

  /**
   * Pre-register channel codes from WEBHOOK_TOKENS config.
   * Format: WEBHOOK_CHANNEL_CODES=code1,code2 (in same order as WEBHOOK_TOKENS)
   * This allows manual pre-mapping without needing per-bot callback URLs.
   */
  preRegisterFromEnv() {
    // First: use channelCodes embedded in WEBHOOK_TOKENS (new format)
    for (const config of this.configs) {
      if (config.channelCode) {
        this.tokenByCode.set(config.channelCode, config.token);
        this.nameByCode.set(config.channelCode, config.channelName);
        console.log(`📌 Pre-registered: ${config.channelName} (${config.channelCode})`);
      }
    }

    // Fallback: use legacy WEBHOOK_CHANNEL_CODES env var (old format)
    const codes = (process.env.WEBHOOK_CHANNEL_CODES || '').split(',').map(s => s.trim()).filter(Boolean);
    codes.forEach((code, idx) => {
      if (this.tokenByCode.has(code)) return; // already registered above
      const config = this.configs[idx];
      if (config && code) {
        this.tokenByCode.set(code, config.token);
        this.nameByCode.set(code, config.channelName);
        console.log(`📌 Pre-registered: ${config.channelName} (${code})`);
      }
    });
  }

  /**
   * Get the per-token callback URL for a given token.
   * Used when registering webhooks so Haven knows which path to POST to.
   * Base URL comes from CALLBACK_URL env var.
   * Single channel: uses CALLBACK_URL as-is (backward compatible)
   * Multi channel:  appends /cb/<n> (short numeric index) so the server can identify the source
   */
  getCallbackUrl(token) {
    const base = (process.env.CALLBACK_URL || '').replace(/\/$/, '');
    if (!base) return null;
    if (this.configs.length <= 1) return base + '/';
    // Use short numeric index instead of full token to keep URL manageable
    const idx = this.configs.findIndex(c => c.token === token);
    return `${base}/cb/${idx + 1}`;
  }

  /**
   * Get the token for a given short channel index (from /cb/<n> path)
   */
  getTokenByIndex(idx) {
    const config = this.configs[idx - 1];
    return config ? config.token : null;
  }
}

// Singleton
const channelManager = new ChannelManager();
module.exports = channelManager;
