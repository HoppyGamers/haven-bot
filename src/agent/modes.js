// ---------------------------------------------------------------------------
// src/agent/modes.js
//
// Stage 3E: Participation modes for the AI agent.
// Handles mention, passive, and active mode message processing.
// ---------------------------------------------------------------------------

// Per-channel cooldown tracking for active mode
const lastResponseTime = new Map();

/**
 * Check if a message should trigger the agent based on the channel's mode.
 *
 * @param {object} message   - { content, user, user_id, channel_id }
 * @param {object} config    - Channel config from getChannelConfig()
 * @returns {boolean}
 */
function shouldRespond(message, config) {
  const { content, user_id } = message;
  const mode = config.mode || 'command';

  console.log(`[Agent] shouldRespond: mode=${mode}, content="${(content||'').slice(0,40)}"`);

  // Never respond to empty messages or webhook messages
  if (!content || !content.trim()) return false;

  // Never respond to our own messages (prevent loops)
  // Bot messages come through as webhook events which we already filter in bot.js

  switch (mode) {

    case 'command':
      // Only responds to slash commands — handled separately
      return false;

    case 'mention': {
      // Responds when agent name appears in the message
      const name = (config.agentName || 'Bob').toLowerCase();
      return content.toLowerCase().includes(name);
    }

    case 'passive': {
      // Responds when message looks like a question the agent can answer
      const confidence = scoreMessage(content);
      const threshold  = config.confidence ?? 0.6;
      return confidence >= threshold;
    }

    case 'active': {
      // Responds to all messages, rate limited by cooldown
      const cooldownMs  = (config.cooldown || 30) * 1000;
      const channelKey  = message.channel_id;
      const lastTime    = lastResponseTime.get(channelKey) || 0;
      const elapsed     = Date.now() - lastTime;

      if (elapsed < cooldownMs) return false;

      // Don't respond to very short messages in active mode
      if (content.trim().split(/\s+/).length < 3) return false;

      return true;
    }

    default:
      return false;
  }
}

/**
 * Record that the agent responded in a channel (for cooldown tracking).
 */
function recordResponse(channelId) {
  lastResponseTime.set(channelId, Date.now());
}

/**
 * Score a message for passive mode — how likely is it that the agent can help?
 * Returns a confidence score between 0 and 1.
 */
function scoreMessage(content) {
  let score = 0;
  const text = content.toLowerCase();

  // Question indicators — high confidence
  if (text.endsWith('?')) score += 0.4;
  if (/^(what|who|when|where|why|how|is|are|was|were|did|do|does|can|could|will|would)\b/.test(text)) score += 0.3;

  // Topic relevance — medium confidence
  if (/\b(f1|formula|race|grand prix|qualifying|championship|driver|team)\b/.test(text)) score += 0.2;
  if (/\b(news|results?|standings?|schedule|calendar|upcoming|next)\b/.test(text)) score += 0.2;
  if (/\b(who won|what happened|tell me|explain|help)\b/.test(text)) score += 0.2;

  // Penalize very short messages
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 4) score -= 0.3;
  if (wordCount < 2) score -= 0.5;

  return Math.min(1, Math.max(0, score));
}

/**
 * Extract the actual question from a mention-mode message.
 * Strips the agent name from the beginning of the message.
 */
function extractQuestion(content, agentName) {
  const name = agentName.toLowerCase();
  let text = content.trim();

  // Remove name from start: "Bob, what time..." → "what time..."
  const patterns = [
    new RegExp(`^${name}[,!]?\\s*`, 'i'),
    new RegExp(`^hey\\s+${name}[,!]?\\s*`, 'i'),
    new RegExp(`^@${name}[,!]?\\s*`, 'i'),
  ];

  for (const pattern of patterns) {
    text = text.replace(pattern, '').trim();
  }

  return text || content;
}

module.exports = { shouldRespond, recordResponse, extractQuestion, scoreMessage };
