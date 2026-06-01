// ---------------------------------------------------------------------------
// src/agent/digest.js
//
// Phase 4A: RSS Digest engine.
// Collects RSS items from a source channel, summarizes via Ollama,
// and posts to a destination channel on a configured schedule.
// ---------------------------------------------------------------------------

const { rssDigests, getDb }  = require('./database');
const { rssFeeds }           = require('../database');
const { chat }               = require('./ollama');
const { getGlobalConfig }    = require('./config');

// ---------------------------------------------------------------------------
// Scheduling helpers
// ---------------------------------------------------------------------------

const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

/**
 * Parse a human-friendly time string into { hour, minute }.
 * Accepts: "9am", "9:30am", "14:00", "09:00"
 */
function parseTime(timeStr) {
  const str = timeStr.toLowerCase().trim();

  // Handle "9am", "9:30am", "2pm"
  const ampm = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampm) {
    let hour   = parseInt(ampm[1]);
    const min  = parseInt(ampm[2] || '0');
    const period = ampm[3];
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return { hour, minute: min };
  }

  // Handle "09:00", "14:30"
  const h24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    return { hour: parseInt(h24[1]), minute: parseInt(h24[2]) };
  }

  return null;
}

/**
 * Check if a digest is due to run now.
 */
function isDue(digest, now = new Date()) {
  const tz      = process.env.TIMEZONE || 'UTC';
  const parsed  = parseTime(digest.time_of_day);
  if (!parsed) return false;

  // Get current time in configured timezone
  const localStr = now.toLocaleString('en-CA', {
    timeZone: tz,
    hour: 'numeric', minute: 'numeric',
    hour12: false, weekday: 'long',
  });

  // Parse "Monday, 09:00"
  const parts = localStr.split(', ');
  const dayName = parts[0].toLowerCase();
  const timeParts = (parts[1] || '').split(':');
  const localHour = parseInt(timeParts[0]);
  const localMin  = parseInt(timeParts[1] || '0');

  // Check time matches (within the current hour)
  if (localHour !== parsed.hour) return false;
  if (localMin > 5) return false; // only trigger in first 5 minutes of the hour

  // Check frequency
  if (digest.frequency === 'daily') return true;

  if (digest.frequency === 'weekly') {
    if (!digest.day_of_week) return false;
    return dayName === digest.day_of_week.toLowerCase();
  }

  return false;
}

/**
 * Collect RSS items posted to a channel since the last run.
 * Falls back to last 7 days for weekly, last 24h for daily.
 */
function collectItems(sourceChannelId, frequency, lastRun) {
  // rss_seen is in haven-bot.db, not haven-agent.db
  // Use better-sqlite3 directly with the main DB path
  const mainDbPath = process.env.DB_PATH ||
    require('path').join(process.cwd(), 'haven-bot.db');
  let db;
  try {
    db = require('better-sqlite3')(mainDbPath);
  } catch (err) {
    console.error('[Digest] Could not open main DB:', err.message);
    return [];
  }

  // Determine cutoff date
  let cutoff;
  if (lastRun) {
    cutoff = new Date(lastRun);
  } else {
    cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (frequency === 'weekly' ? 7 : 1));
  }

  // Get active feeds for this channel
  const feeds = rssFeeds.getActive ? rssFeeds.getActive() : [];
  const channelFeeds = feeds.filter(f => f.channel_id === sourceChannelId);

  if (channelFeeds.length === 0) return [];

  // Collect seen items since cutoff from each feed
  const items = [];
  const feedIds = channelFeeds.map(f => f.id);

  if (feedIds.length === 0) return [];

  const placeholders = feedIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT rs.item_guid as guid, rs.item_title as title, rs.feed_id, rs.seen_at, rf.title as feed_title, rf.url as feed_url
    FROM rss_seen rs
    JOIN rss_feeds rf ON rs.feed_id = rf.id
    WHERE rs.feed_id IN (${placeholders})
    AND rs.seen_at > ?
    ORDER BY rs.seen_at DESC
  `).all(...feedIds, cutoff.toISOString());

  return rows;
}

// ---------------------------------------------------------------------------
// Digest generation
// ---------------------------------------------------------------------------

/**
 * Generate a digest summary using Ollama.
 */
async function generateDigest(items, sourceChannelName, frequency, config) {
  const period = frequency === 'daily' ? 'today' : 'this week';

  // Build a simple item list for the prompt
  // Use real article titles where available, fall back to guid
  const itemList = items.slice(0, 30).map((item, i) => {
    const title = item.title || item.guid;
    const source = item.feed_title || item.feed_url || 'Unknown';
    return `${i + 1}. [${source}] ${title}`;
  }).join('\n');

  const prompt = `You are summarizing ${frequency} news for the "${sourceChannelName}" channel.

Here are the actual article titles posted ${period} (format: [Source] Title):

${itemList}

Write a concise ${frequency} digest summary using ONLY these real articles.
Do NOT invent stories or add information not present in the titles above.
Group related articles by topic. Highlight the most important stories.
Keep it readable and engaging. Aim for 200-400 words.
Today's date is ${new Date().toDateString()}.`;

  const response = await chat({
    ollamaUrl:    config.ollamaUrl,
    model:        config.ollamaModel,
    systemPrompt: `You are ${config.agentName}, creating a ${frequency} news digest. Be concise and informative.`,
    messages:     [{ role: 'user', content: prompt }],
  });

  return response;
}

// ---------------------------------------------------------------------------
// Main digest runner
// ---------------------------------------------------------------------------

/**
 * Check all configured digests and run any that are due.
 * Called by the scheduler every hour.
 */
async function runDueDigests(bot, channelManager) {
  const config  = getGlobalConfig();
  if (!config.enabled) return;

  const digests = rssDigests.getDue();
  if (digests.length === 0) return;

  const now = new Date();

  for (const digest of digests) {
    if (!isDue(digest, now)) continue;

    console.log(`[Digest] Running digest ${digest.id}: ${digest.source_channel_id} → ${digest.dest_channel_id}`);

    try {
      const items = collectItems(digest.source_channel_id, digest.frequency, digest.last_run);

      if (items.length < digest.min_items) {
        console.log(`[Digest] Skipping digest ${digest.id} — only ${items.length} items (min: ${digest.min_items})`);
        rssDigests.updateLastRun(digest.id);
        continue;
      }

      // Get source channel name for the digest header
      const sourceChannelName = channelManager.getChannelName(digest.source_channel_id) || digest.source_channel_id;
      const destChannelName   = channelManager.getChannelName(digest.dest_channel_id) || digest.dest_channel_id;
      const tz = process.env.TIMEZONE || 'UTC';
      const dateStr = now.toLocaleDateString('en-US', { timeZone: tz, dateStyle: 'long' });

      const summary = await generateDigest(items, sourceChannelName, digest.frequency, config);

      if (!summary || !summary.trim()) {
        console.warn(`[Digest] Empty summary for digest ${digest.id}`);
        continue;
      }

      const header = digest.frequency === 'weekly'
        ? `📰 **Weekly Digest — ${sourceChannelName}** (${dateStr})\n\n`
        : `📰 **Daily Digest — ${sourceChannelName}** (${dateStr})\n\n`;

      const footer = `\n\n_${items.length} items from #${sourceChannelName} · Summarized by ${config.agentName}_`;

      await bot.sendMessage(header + summary + footer, digest.dest_channel_id);
      rssDigests.updateLastRun(digest.id);

      console.log(`[Digest] ✅ Digest ${digest.id} posted to ${destChannelName} (${items.length} items)`);

    } catch (err) {
      console.error(`[Digest] ❌ Error running digest ${digest.id}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Digest scheduler
// ---------------------------------------------------------------------------

let digestInterval = null;

function startDigestScheduler(bot, channelManager) {
  if (digestInterval) return;

  // Check every 30 minutes
  const intervalMs = 30 * 60 * 1000;

  console.log('📊 RSS Digest scheduler started (checking every 30 minutes)');

  digestInterval = setInterval(() => {
    runDueDigests(bot, channelManager).catch(err => {
      console.error('[Digest] Scheduler error:', err.message);
    });
  }, intervalMs);

  // Run once on startup in case we missed a scheduled time
  setTimeout(() => {
    runDueDigests(bot, channelManager).catch(() => {});
  }, 5000);

  return digestInterval;
}

function stopDigestScheduler() {
  if (digestInterval) {
    clearInterval(digestInterval);
    digestInterval = null;
  }
}

module.exports = {
  startDigestScheduler,
  stopDigestScheduler,
  runDueDigests,
  isDue,
  parseTime,
  collectItems,
  generateDigest,
};
