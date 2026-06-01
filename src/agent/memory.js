// ---------------------------------------------------------------------------
// src/agent/memory.js
//
// Stage 3B: Persistent memory and recall.
// Detects remember/recall intent in user messages and manages memory storage.
// Memory is injected into the system prompt so Bob uses it naturally.
// ---------------------------------------------------------------------------

const { memory } = require('./database');

// Phrases that trigger storing a memory
const REMEMBER_PATTERNS = [
  /^remember\s+(?:that\s+)?(.+)/i,
  /^please\s+remember\s+(?:that\s+)?(.+)/i,
  /^note\s+(?:that\s+)?(.+)/i,
  /^don'?t\s+forget\s+(?:that\s+)?(.+)/i,
  /^keep\s+in\s+mind\s+(?:that\s+)?(.+)/i,
  /^save\s+(?:that\s+)?(.+)/i,
  /^store\s+(?:that\s+)?(.+)/i,
];

// Phrases that trigger recalling memories
const RECALL_PATTERNS = [
  /^what\s+do\s+you\s+(?:know|remember)\s+about\s+me/i,
  /^what\s+have\s+i\s+told\s+you/i,
  /^what\s+do\s+you\s+know\s+about\s+(?:this\s+)?channel/i,
  /^recall\s+(?:my\s+)?(?:preferences?|info|information)/i,
  /^show\s+(?:my\s+)?memories?/i,
  /^list\s+(?:my\s+)?memories?/i,
  /^forget\s+everything\s+about\s+me/i,
  /^clear\s+(?:my\s+)?memories?/i,
];

/**
 * Check if a message is a remember request.
 * Returns the fact to store, or null if not a remember request.
 */
function detectRemember(message) {
  for (const pattern of REMEMBER_PATTERNS) {
    const match = message.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Check if a message is a recall/forget request.
 * Returns the type of recall request or null.
 */
function detectRecall(message) {
  for (const pattern of RECALL_PATTERNS) {
    if (pattern.test(message)) {
      if (/forget|clear/i.test(message)) return 'clear';
      if (/channel/i.test(message)) return 'channel';
      return 'user';
    }
  }
  return null;
}

/**
 * Store a memory fact for a user or channel.
 */
function rememberFact(scope, scopeId, fact) {
  // Generate a simple key from the fact content
  const key = `fact_${Date.now()}`;
  memory.set(scope, scopeId, key, fact);
  return key;
}

/**
 * Get all memories for a user and channel, formatted for injection.
 * Returns a string to append to the system prompt, or empty string if no memories.
 */
function getMemoryContext(userId, channelId) {
  const userMemories    = memory.getAll('user', userId.toString());
  const channelMemories = memory.getAll('channel', channelId);

  const lines = [];

  if (userMemories.length > 0) {
    lines.push('Facts about this user:');
    userMemories.forEach(m => lines.push(`- ${m.value}`));
  }

  if (channelMemories.length > 0) {
    lines.push('Facts about this channel:');
    channelMemories.forEach(m => lines.push(`- ${m.value}`));
  }

  if (lines.length === 0) return '';

  return `\n\nPersistent memory (use naturally in responses):\n${lines.join('\n')}`;
}

/**
 * Format all memories for display to the user.
 */
function formatMemoriesForDisplay(userId, channelId) {
  const userMemories    = memory.getAll('user', userId.toString());
  const channelMemories = memory.getAll('channel', channelId);

  const lines = [];

  if (userMemories.length > 0) {
    lines.push('**About you:**');
    userMemories.forEach(m => lines.push(`• ${m.value}`));
  }

  if (channelMemories.length > 0) {
    lines.push('**About this channel:**');
    channelMemories.forEach(m => lines.push(`• ${m.value}`));
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

module.exports = {
  detectRemember,
  detectRecall,
  rememberFact,
  getMemoryContext,
  formatMemoriesForDisplay,
};
