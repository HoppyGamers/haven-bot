// ---------------------------------------------------------------------------
// RSS fetcher and poller
// Uses Node.js built-in https/http — no external XML parser needed.
// Handles RSS 2.0 and Atom feeds.
// ---------------------------------------------------------------------------

const https = require('https');
const http  = require('http');
// DB operations are injected by the poller to avoid circular dependencies

// ---------------------------------------------------------------------------
// Minimal XML field extractor
// Pulls the text content of the first matching tag from an XML string.
// ---------------------------------------------------------------------------
function extractField(xml, ...tags) {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
    const match = xml.match(re);
    if (match && match[1].trim()) return match[1].trim();
  }
  return '';
}

function extractAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i');
  const match = xml.match(re);
  return match ? match[1] : '';
}

/**
 * Parse RSS 2.0 or Atom feed XML into a normalized array of items.
 * Returns { feedTitle, items: [{ guid, title, link, description }] }
 */
function parseFeed(xml) {
  const isAtom = xml.includes('<feed');

  // Feed title
  const feedTitle = extractField(xml, 'title') || 'RSS Feed';

  // Split into items
  const itemTag   = isAtom ? 'entry' : 'item';
  const itemRegex = new RegExp(`<${itemTag}[\\s>][\\s\\S]*?<\\/${itemTag}>`, 'gi');
  const rawItems  = xml.match(itemRegex) || [];

  const items = rawItems.map(raw => {
    const title = extractField(raw, 'title');
    const link  = isAtom
      ? (extractAttr(raw, 'link', 'href') || extractField(raw, 'link'))
      : extractField(raw, 'link');
    const desc  = extractField(raw, 'summary', 'description', 'content');
    const guid  = extractField(raw, 'id', 'guid') || link || title;

    return {
      guid:        guid.slice(0, 500),
      title:       title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, '').trim(),
      link:        link.trim(),
      description: desc
        .replace(/<[^>]+>/g, '')       // strip HTML tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200),
    };
  });

  return { feedTitle, items };
}

/**
 * Fetch raw XML from a URL.
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'HavenBot-RSSReader/1.0',
        'Accept': 'application/rss+xml, application/atom+xml, text/xml, */*',
      },
      timeout: 10000,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

/**
 * Fetch and parse a single feed URL.
 * Returns { feedTitle, items } or throws on error.
 */
async function fetchFeed(url) {
  const xml = await fetchUrl(url);
  return parseFeed(xml);
}

/**
 * Format a single RSS item for posting in chat.
 */
function formatItem(feedTitle, item) {
  let message = `📰 **${feedTitle}**\n\n`;
  message += `**${item.title || 'Untitled'}**\n`;
  if (item.link)        message += `🔗 ${item.link}\n`;
  if (item.description) message += `📝 ${item.description}${item.description.length >= 200 ? '...' : ''}`;
  return message.trim();
}

/**
 * Check all active feeds for new items and post them.
 * @param {HavenBot} bot
 */
async function checkFeeds(bot, rssFeeds) {
  const feeds = rssFeeds.getActive();
  if (feeds.length === 0) return;

  const maxItems = parseInt(process.env.RSS_MAX_ITEMS || '5', 10);

  for (const feed of feeds) {
    try {
      const { feedTitle, items } = await fetchFeed(feed.url);

      // Update stored feed title on first fetch
      if (!feed.title && feedTitle) {
        rssFeeds.updateTitle(feed.id, feedTitle);
      }

      const displayTitle = feed.title || feedTitle;

      // Filter by keyword if set
      const filtered = feed.filter
        ? items.filter(i =>
            i.title.toLowerCase().includes(feed.filter.toLowerCase()) ||
            i.description.toLowerCase().includes(feed.filter.toLowerCase())
          )
        : items;

      // Find new items (not yet seen)
      const newItems = filtered.filter(i => !rssFeeds.isSeen(feed.id, i.guid));

      // Cap to avoid flooding
      const toPost = newItems.slice(0, maxItems);

      for (const item of toPost) {
        try {
          await bot.sendMessage(formatItem(displayTitle, item), feed.channel_id);
          rssFeeds.markSeen(feed.id, item.guid);
        } catch (err) {
          console.error(`[RSS] Failed to post item from feed ${feed.id}:`, err.message);
        }
      }

      if (newItems.length > maxItems) {
        await bot.sendMessage(
          `📰 **${displayTitle}** — ${newItems.length - maxItems} more new item${newItems.length - maxItems !== 1 ? 's' : ''} skipped to avoid flooding.`,
          feed.channel_id
        );
      }

      rssFeeds.updateLastChecked(feed.id);
      console.log(`[RSS] Feed ${feed.id} checked — ${toPost.length} new item(s) posted`);
    } catch (err) {
      console.error(`[RSS] Error checking feed ${feed.id} (${feed.url}):`, err.message);
    }
  }
}

/**
 * Start the RSS polling loop.
 */
function startRssPoller(bot, rssFeeds) {
  const intervalMinutes = parseInt(process.env.RSS_CHECK_INTERVAL || '15', 10);
  const intervalMs = intervalMinutes * 60 * 1000;

  console.log(`📡 RSS poller started (checking every ${intervalMinutes} minute${intervalMinutes !== 1 ? 's' : ''})`);

  // Don't run immediately on start — wait one interval so feeds can be added first
  return setInterval(() => checkFeeds(bot, rssFeeds), intervalMs);
}

module.exports = { fetchFeed, checkFeeds, startRssPoller };
