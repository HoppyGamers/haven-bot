// ---------------------------------------------------------------------------
// RSS commands
//
//   /rss add <url> [--filter <keyword>]  — add a feed (admin)
//   /rss remove <id>                     — remove a feed (admin)
//   /rss pause <id>                      — pause a feed (admin)
//   /rss resume <id>                     — resume a feed (admin)
//   /rss list                            — show all feeds (anyone)
//   /rss check                           — manually trigger check (admin)
// ---------------------------------------------------------------------------

const { rssFeeds, admins } = require('../database');
const { fetchFeed, checkFeeds } = require('../rss');

// ---------------------------------------------------------------------------
// /rss add <url> [--filter <keyword>]
// ---------------------------------------------------------------------------
async function rssAdd(bot, data) {
  const { user_id: userId, user, args = [] } = data;

  if (!admins.isAdmin(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can add RSS feeds.`);
  }

  const filterIdx = args.indexOf('--filter');
  const mainArgs  = filterIdx === -1 ? args : args.slice(0, filterIdx);
  const filter    = filterIdx !== -1 ? args.slice(filterIdx + 1).join(' ').trim() : null;

  const url = mainArgs[0];
  if (!url) {
    return bot.sendMessage(
      `❌ **Invalid Command**\nUsage: \`/rss add <url> [--filter <keyword>]\`\n\n` +
      `Example: \`/rss add https://feeds.ign.com/ign/all --filter PlayStation\``
    );
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return bot.sendMessage(`❌ **Invalid URL**\nURL must start with \`http://\` or \`https://\`.`);
  }

  await bot.sendMessage(`⏳ Fetching feed, please wait...`);

  // Try fetching to validate + get feed title
  let feedTitle = url;
  let initialGuids = [];
  try {
    const { feedTitle: ft, items } = await fetchFeed(url);
    feedTitle    = ft || url;
    initialGuids = items.map(i => i.guid);
  } catch (err) {
    return bot.sendMessage(
      `❌ **Feed Error**\nCouldn't fetch that URL: ${err.message}\n` +
      `Make sure it's a valid RSS or Atom feed.`
    );
  }

  const result = rssFeeds.add(url, user, filter || null, data.channel_id);
  if (!result) {
    return bot.sendMessage(`⚠️ **Already Added**\nThis feed is already being monitored.`);
  }

  const feedId = result.lastInsertRowid;

  // Store the feed title
  rssFeeds.updateTitle(feedId, feedTitle);

  // Mark all current items as seen so we don't flood old content
  rssFeeds.markAllSeen(feedId, initialGuids);

  const filterLine = filter ? `\n🔍 Filter: \`${filter}\`` : '';
  return bot.sendMessage(
    `✅ **RSS Feed Added** (ID: ${feedId})\n` +
    `📰 **${feedTitle}**\n` +
    `🔗 ${url}` +
    filterLine +
    `\n\nNew items will be posted automatically. Use \`/rss check\` to fetch now.`
  );
}

// ---------------------------------------------------------------------------
// /rss remove <id>
// ---------------------------------------------------------------------------
async function rssRemove(bot, data) {
  const { user_id: userId, args = [] } = data;

  if (!admins.isAdmin(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can remove RSS feeds.`);
  }

  const feedId = parseInt(args[0]);
  if (!feedId) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/rss remove <id>\`\nFind feed IDs with \`/rss list\`.`);
  }

  const feed = rssFeeds.get(feedId);
  if (!feed) {
    return bot.sendMessage(`❌ **Not Found**\nNo feed with ID ${feedId}.`);
  }

  rssFeeds.remove(feedId);
  return bot.sendMessage(`✅ **Feed Removed**\n**${feed.title || feed.url}** (ID: ${feedId}) has been removed.`);
}

// ---------------------------------------------------------------------------
// /rss pause <id>
// ---------------------------------------------------------------------------
async function rssPause(bot, data) {
  const { user_id: userId, args = [] } = data;

  if (!admins.isAdmin(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can pause feeds.`);
  }

  const feedId = parseInt(args[0]);
  if (!feedId) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/rss pause <id>\``);
  }

  const feed = rssFeeds.get(feedId);
  if (!feed) return bot.sendMessage(`❌ **Not Found**\nNo feed with ID ${feedId}.`);
  if (!feed.active) return bot.sendMessage(`⚠️ **Already Paused**\nFeed ${feedId} is already paused.`);

  rssFeeds.setActive(feedId, false);
  return bot.sendMessage(`⏸️ **Feed Paused**\n**${feed.title || feed.url}** (ID: ${feedId}) will no longer post new items.`);
}

// ---------------------------------------------------------------------------
// /rss resume <id>
// ---------------------------------------------------------------------------
async function rssResume(bot, data) {
  const { user_id: userId, args = [] } = data;

  if (!admins.isAdmin(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can resume feeds.`);
  }

  const feedId = parseInt(args[0]);
  if (!feedId) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/rss resume <id>\``);
  }

  const feed = rssFeeds.get(feedId);
  if (!feed) return bot.sendMessage(`❌ **Not Found**\nNo feed with ID ${feedId}.`);
  if (feed.active) return bot.sendMessage(`⚠️ **Already Active**\nFeed ${feedId} is already running.`);

  rssFeeds.setActive(feedId, true);
  return bot.sendMessage(`▶️ **Feed Resumed**\n**${feed.title || feed.url}** (ID: ${feedId}) will resume posting new items.`);
}

// ---------------------------------------------------------------------------
// /rss list
// ---------------------------------------------------------------------------
async function rssList(bot, data) {
  const feeds = rssFeeds.getAll();

  if (feeds.length === 0) {
    return bot.sendMessage(
      `📡 **RSS Feeds**\n\nNo feeds configured.\nAdmins can use \`/rss add <url>\` to add one.`
    );
  }

  const channelManager = require('../channels');

  let message = `📡 **RSS Feeds (${feeds.length})**\n\n`;
  for (const feed of feeds) {
    const status      = feed.active ? '🟢' : '⏸️';
    const lastCheck   = feed.last_checked
      ? new Date(feed.last_checked).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Never';
    const filterLine  = feed.filter ? ` • Filter: \`${feed.filter}\`` : '';
    const channelName = feed.channel_id
      ? channelManager.getChannelName(feed.channel_id) || feed.channel_id
      : 'All channels';

    message += `${status} **[${feed.id}] ${feed.title || feed.url}**\n`;
    message += `📺 Channel: ${channelName}\n`;
    message += `🔗 ${feed.url}\n`;
    message += `🕐 Last checked: ${lastCheck}${filterLine}\n\n`;
  }

  return bot.sendMessage(message.trim());
}

// ---------------------------------------------------------------------------
// /rss check  — manually trigger a feed check right now
// ---------------------------------------------------------------------------
async function rssCheck(bot, data) {
  const { user_id: userId } = data;

  if (!admins.isAdmin(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can manually trigger a feed check.`);
  }

  const activeFeeds = rssFeeds.getActive();
  if (activeFeeds.length === 0) {
    return bot.sendMessage(`📡 **No Active Feeds**\nAdd a feed with \`/rss add <url>\`.`);
  }

  await bot.sendMessage(`📡 Checking ${activeFeeds.length} feed${activeFeeds.length !== 1 ? 's' : ''}...`);
  // Use the raw bot instance (not channelBot proxy) so items post to their configured channels
  const rawBot = data.rawBot || bot;
  await checkFeeds(rawBot, rssFeeds);
  return bot.sendMessage(`✅ Feed check complete.`);
}

// ---------------------------------------------------------------------------
// Route /rss subcommands
// ---------------------------------------------------------------------------
async function rssRouter(bot, data) {
  const subcommand = (data.args || [])[0]?.toLowerCase();
  const subData    = { ...data, args: (data.args || []).slice(1) };

  switch (subcommand) {
    case 'add':    return rssAdd(bot, subData);
    case 'remove': return rssRemove(bot, subData);
    case 'pause':  return rssPause(bot, subData);
    case 'resume': return rssResume(bot, subData);
    case 'list':   return rssList(bot, subData);
    case 'check':  return rssCheck(bot, subData);
    default:
      return bot.sendMessage(
        `📡 **RSS Commands**\n\n` +
        `\`/rss add <url> [--filter <keyword>]\` — add a feed\n` +
        `\`/rss remove <id>\` — remove a feed\n` +
        `\`/rss pause <id>\` — pause a feed\n` +
        `\`/rss resume <id>\` — resume a feed\n` +
        `\`/rss list\` — show all feeds\n` +
        `\`/rss check\` — check for new items now`
      );
  }
}

module.exports = { rssRouter };
