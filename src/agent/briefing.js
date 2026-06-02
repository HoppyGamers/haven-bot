// ---------------------------------------------------------------------------
// src/agent/briefing.js
//
// Phase 4B: AI Event Briefing.
// When a calendar notification fires, Bob searches for current context
// about the event and posts an enhanced briefing alongside the plain reminder.
// ---------------------------------------------------------------------------

const { chat }             = require('./ollama');
const { search }           = require('./search');
const { getGlobalConfig, getChannelConfig, isEnabledForChannel } = require('./config');
const { getDb }            = require('./database');

/**
 * Generate and post an AI briefing for a calendar event notification.
 *
 * @param {object} bot          - Haven bot instance
 * @param {object} notification - { event_id, title, event_time, channel_id, offset_label }
 */
async function sendEventBriefing(bot, notification) {
  const agentDb = getDb();
  if (!agentDb) return; // Agent not initialized

  const { title, channel_id, offset_label, event_time } = notification;

  // Check if agent is enabled for this channel
  if (!isEnabledForChannel(channel_id, agentDb)) return;

  const config = getChannelConfig(channel_id, agentDb);
  const tz     = process.env.TIMEZONE || 'UTC';

  const eventDate = new Date(event_time).toLocaleDateString('en-US', {
    timeZone: tz, dateStyle: 'long'
  });

  console.log(`[Briefing] Generating briefing for: ${title} (${offset_label} to go)`);

  try {
    // Search for current context about the event
    let searchContext = '';
    if (config.searxngUrl) {
      try {
        const query = `${title} ${new Date().getFullYear()}`;
        const { formatted } = await search(query, config.searxngUrl, 5);
        if (formatted && formatted !== 'No search results found.') {
          searchContext = formatted;
        }
      } catch (err) {
        console.warn(`[Briefing] Search failed: ${err.message}`);
      }
    }

    // Build the briefing prompt
    const searchSection = searchContext
      ? `\n\nCurrent search results for context:\n${searchContext}\n\nUse these results to provide accurate, current information.`
      : '';

    const systemPrompt =
      `You are ${config.agentName}, providing a pre-event briefing. ` +
      `Be informative, engaging, and concise. Today is ${new Date().toDateString()}.`;

    const userPrompt =
      `Write a brief AI briefing for this upcoming event: "${title}" on ${eventDate}.\n` +
      `The event starts in ${offset_label}.\n` +
      `Include relevant context, what to watch for, key details, and why it matters.\n` +
      `Keep it under 300 words. Be specific and use current information if available.${searchSection}`;

    const response = await chat({
      ollamaUrl:    config.ollamaUrl,
      model:        config.ollamaModel,
      systemPrompt,
      messages:     [{ role: 'user', content: userPrompt }],
    });

    if (!response || !response.trim()) return;

    const briefingMessage =
      `🤖 **${config.agentName}'s Briefing — ${title}**\n\n` +
      response.trim();

    await bot.sendMessage(briefingMessage, channel_id);
    console.log(`[Briefing] ✅ Briefing sent for: ${title}`);

  } catch (err) {
    console.error(`[Briefing] ❌ Error generating briefing for ${title}:`, err.message);
    // Silently fail — the plain reminder was already sent
  }
}

module.exports = { sendEventBriefing };
