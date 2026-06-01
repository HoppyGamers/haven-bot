require('dotenv').config();
const HavenBot = require('./bot');
const { users, channels, stats } = require('./database');
const moderationCommands = require('./commands/moderation');
const soundboardCommands = require('./commands/soundboard');
const customCommands     = require('./commands/custom');
const { customCommands: customCommandsDb, rssFeeds } = require('./database');
const calendarCommands = require('./commands/calendar');
const rssCommands      = require('./commands/rss');
const { startRssPoller } = require('./rss');
const channelManager     = require('./channels');

// Agent — loaded only when AGENT_ENABLED=true
const AGENT_ENABLED = (process.env.AGENT_ENABLED || 'false').toLowerCase() === 'true';
let agentModule = null;
const { startNotifier }  = require('./notifier');
const { checkAchievements, formatUnlockAnnouncement, getGlobalRank, getTotalMessages } = require('./achievements');
const { db } = require('./database');

const bot = new HavenBot();

// XP cooldown — track last XP award time per user (5 second minimum gap)
const xpCooldowns = new Map();
const XP_COOLDOWN_MS = parseInt(process.env.XP_COOLDOWN_MS || "5000", 10);

function isOnXpCooldown(userId) {
  const last = xpCooldowns.get(userId);
  if (!last) return false;
  return Date.now() - last < XP_COOLDOWN_MS;
}

function setXpCooldown(userId) {
  xpCooldowns.set(userId, Date.now());
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------
bot.on('command', async (data) => {
  const { command, user } = data;
  console.log(`\n📩 Command received: /${command} by ${user}`);

  // Build enrichedData and channelBot FIRST so they're available to XP/achievement block
  const enrichedData = {
    ...data,
    args: data.args && data.args.length > 0
      ? data.args
      : (data.raw_content || '').trim().split(/\s+/).slice(1).filter(Boolean),
  };

  const channelBot = new Proxy(bot, {
    get(target, prop) {
      if (prop === 'sendMessage') {
        return (content, options = {}) => target.sendMessage(content, enrichedData.channel_id, options);
      }
      if (prop === 'playSound') {
        return (soundName) => target.playSound(soundName, enrichedData.channel_id);
      }
      return target[prop];
    }
  });

  // Award XP and check achievements
  // Skip XP for moderation/admin/daily commands, skip achievements for read-only commands
  const skipXp          = ['ban','kick','warn','mute','unmute','unban','warnings','modlog','addadmin','removeadmin','admins','addcommand','editcommand','removecommand','daily','calendar','rss'].includes(command);
  const skipAchievements = ['help','ping','sounds','stopsound','commands','customcommands','profile','leaderboard','top','calendar','rss'].includes(command);

  try {
    const userId = data.user_id.toString();
    const existingUser = users.get(userId);
    users.getOrCreate(userId, user);
    channels.getOrCreate(data.channel_id, 'Channel');

    // First-time user greeting
    if (!existingUser) {
      const defaultGreeting = `👋 Welcome to the server, **${user}**! Type \`/help\` to see what I can do.`;
      const greeting = (process.env.BOT_FIRST_TIME_GREETING || defaultGreeting)
        .replace(/\{user\}/gi, user);
      await bot.sendMessage(greeting, data.channel_id || enrichedData.channel_id);
    }

    if (!skipXp && !isOnXpCooldown(userId)) {
      setXpCooldown(userId);
      const xpResult = stats.addMessage(userId, data.channel_id, 10);
      // Announce level up
      if (xpResult && xpResult.leveledUp) {
        await bot.sendMessage(
          `🎉 **Level Up!** **${user}** reached level ${xpResult.newLevel}!`,
          enrichedData.channel_id
        );
      }
    }

    if (!skipXp && !skipAchievements) {
      const totalMessages = getTotalMessages(db, userId);
      const globalRank    = getGlobalRank(db, userId);
      const userRecord    = users.get(userId);

      const unlocked = checkAchievements(db, userId, user, {
        totalMessages,
        globalLevel: userRecord ? userRecord.level : 1,
        streak:      userRecord ? (userRecord.daily_streak || 0) : 0,
        globalRank,
      });

      if (unlocked.length > 0) {
        const announcement = formatUnlockAnnouncement(user, unlocked);
        await bot.sendMessage(announcement, enrichedData.channel_id);
      }
    }
  } catch (err) {
    console.error('Error tracking XP/achievements:', err.message);
  }

  // enrichedData and channelBot defined above before XP block

  try {
  switch (command) {
    // --- Profile commands ---
    case 'ping':
      await channelBot.sendMessage(`🏓 Pong! ${user} just pinged me!`);
      break;

    case 'profile':
      await channelBot.advancedCommands.profile(channelBot, enrichedData);
      break;

    case 'level':
      await channelBot.advancedCommands.level(channelBot, enrichedData);
      break;

    case 'stats':
      await channelBot.advancedCommands.stats(channelBot, enrichedData);
      break;

    case 'leaderboard':
      await channelBot.advancedCommands.leaderboard(channelBot, enrichedData);
      break;

    case 'daily':
      await channelBot.advancedCommands.daily(channelBot, enrichedData);
      break;

    case 'top':
      await channelBot.advancedCommands.top(channelBot, enrichedData);
      break;

    // --- Moderation commands ---
    case 'addadmin':
      await moderationCommands.addadmin(channelBot, enrichedData);
      break;

    case 'admins':
      await moderationCommands.listAdmins(channelBot, enrichedData);
      break;

    case 'removeadmin':
      await moderationCommands.removeadmin(channelBot, enrichedData);
      break;

    case 'ban':
      await moderationCommands.ban(channelBot, enrichedData);
      break;

    case 'kick':
      await moderationCommands.kick(channelBot, enrichedData);
      break;

    case 'warn':
      await moderationCommands.warn(channelBot, enrichedData);
      break;

    case 'mute':
      await moderationCommands.mute(channelBot, enrichedData);
      break;

    case 'unmute':
      await moderationCommands.unmute(channelBot, enrichedData);
      break;

    case 'unban':
      await moderationCommands.unban(channelBot, enrichedData);
      break;

    case 'warnings':
      await moderationCommands.getWarnings(channelBot, enrichedData);
      break;

    case 'modlog':
      await moderationCommands.modlog(channelBot, enrichedData);
      break;

    // --- Music / Soundboard ---
    case 'soundboard':
      await soundboardCommands.soundboard(channelBot, enrichedData);
      break;

    case 'sounds':
      await soundboardCommands.sounds(channelBot, enrichedData);
      break;

    case 'stopsound':
      await soundboardCommands.stopsound(channelBot, enrichedData);
      break;

    // --- Custom command management ---
    case 'addcommand':
      await customCommands.addcommand(channelBot, enrichedData);
      break;

    case 'editcommand':
      await customCommands.editcommand(channelBot, enrichedData);
      break;

    case 'removecommand':
      await customCommands.removecommand(channelBot, enrichedData);
      break;

    case 'commands':
    case 'customcommands':
      await customCommands.listCommands(channelBot, enrichedData);
      break;

    // --- Calendar ---
    case 'calendar':
      await calendarCommands.calendarRouter(channelBot, enrichedData);
      break;

    case 'rsvp':
      await calendarCommands.rsvp(channelBot, enrichedData);
      break;

    // --- RSS ---
    case 'rss':
      await rssCommands.rssRouter(channelBot, enrichedData);
      break;

    // --- Help ---
    case 'help':
      const helpText = `
🤖 **Haven Bot Help**

**User Profile:**
\`/profile\` - View your profile
\`/level\` - Check your level
\`/stats\` - View detailed stats
\`/daily\` - Claim daily bonus

**Leaderboards:**
\`/leaderboard\` - Channel leaderboard
\`/top\` - Global top users

**Moderation (Admin Only):**
\`/ban @user [reason]\` - Ban a user permanently
\`/kick @user [reason]\` - Kick a user
\`/warn @user [reason]\` - Warn a user (3 = auto-kick)
\`/mute @user [duration] [reason]\` - Mute (e.g. \`30m\`, \`2h\`, \`1d\`)
\`/unmute @user\` - Unmute a user
\`/unban @user\` - Unban a user
\`/warnings [@user]\` - Check warnings
\`/modlog\` - View moderation log
\`/addadmin [@user] [role]\` - Add admin/moderator
\`/admins\` - List all admins

**Soundboard:**
\`/soundboard <sound>\` - Play a soundboard sound
\`/sounds\` - List all available sounds
\`/stopsound\` - Stop current sound

**RSS Feeds:**
\`/rss list\` - Show monitored feeds
\`/rss add <url>\` - Add a feed (admin)
\`/rss remove <id>\` - Remove a feed (admin)
\`/rss pause <id>\` - Pause a feed (admin)
\`/rss resume <id>\` - Resume a feed (admin)
\`/rss check\` - Check for new items now (admin)

**Calendar:**
\`/calendar list\` - Upcoming events in this channel
\`/calendar list all\` - All events across all channels (admin)
\`/calendar add <date> <time> <title>\` - Create event (admin)
\`/calendar view <id>\` - View event details
\`/calendar edit <id> <field> <value>\` - Edit an event (admin)
\`/calendar delete <id>\` - Delete an event (admin)
\`/rsvp <id>\` - Toggle attendance

**Custom Commands:**
\`/customcommands\` - List all custom commands
*(Use \`/addcommand\`, \`/editcommand\`, \`/removecommand\` to manage)*

**Fun:**
\`/ping\` - Test the bot
\`/help\` - This message
      `.trim();

      const helpDeleteSecs = parseInt(process.env.HELP_DELETE_SECONDS || '0', 10);
      const helpMsg = await bot.sendMessage(helpText, enrichedData.channel_id);

      // Auto-delete help message after configured delay (0 = never delete)
      if (helpDeleteSecs > 0 && helpMsg && helpMsg.message_id) {
        setTimeout(async () => {
          try {
            await bot.deleteMessage(helpMsg.message_id, enrichedData.channel_id);
          } catch (err) {
            console.error('[help] Failed to delete help message:', err.message);
          }
        }, helpDeleteSecs * 1000);
      }
      break;

    default: {
      // Check if this is the agent command
      if (AGENT_ENABLED && agentModule && agentModule.isAgentCommand(command)) {
        await agentModule.handleAgentCommand(channelBot, enrichedData);
        break;
      }
      // Check if it's a custom command before reporting unknown
      const customCmd = customCommandsDb.get(command);
      if (customCmd) {
        await customCommands.executeCustomCommand(channelBot, enrichedData, customCmd);
      } else {
        await channelBot.sendMessage(
          `❓ Unknown command: \`/${command}\`. Type \`/help\` for available commands.`
        );
      }
    }
  }
  } catch (err) {
    // Log the full error so it's visible in the console, but don't crash
    console.error(`❌ Error handling /${command}:`, err);
    try {
      await channelBot.sendMessage(
        `⚠️ **Internal Error**\nSomething went wrong running \`/${command}\`. The error has been logged.`
      );
    } catch {
      // If even the error message fails, just log it
      console.error('Failed to send error message to chat');
    }
  }
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
bot.on('error', (err) => {
  console.error('❌ Bot error:', err.message);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function main() {
  await bot.init();

  // Load agent if enabled
  if (AGENT_ENABLED) {
    agentModule = require('./agent/index');
    await agentModule.initAgent(bot, channelManager);
  }

  // Start notification runner
  startNotifier(bot);

  // Start RSS poller
  startRssPoller(bot, rssFeeds);

  // Register all slash commands with Haven so they appear in the command menu
  const commandList = [
    // Profile
    { command: 'profile',    description: 'View your profile or another users' },
    { command: 'level',      description: 'Check your channel level and XP' },
    { command: 'stats',      description: 'View detailed stats and global rank' },
    { command: 'daily',      description: 'Claim your daily XP bonus' },
    // Leaderboards
    { command: 'leaderboard', description: 'Show the channel leaderboard (use global for worldwide)' },
    { command: 'top',         description: 'Show the global top users (e.g. /top 10)' },
    // Soundboard
    { command: 'soundboard', description: 'Play a soundboard sound' },
    { command: 'sounds',     description: 'List all available sounds' },
    { command: 'stopsound',  description: 'Stop the current sound' },
    // Moderation
    { command: 'ban',        description: 'Ban a user (admin only)' },
    { command: 'kick',       description: 'Kick a user (admin only)' },
    { command: 'warn',       description: 'Warn a user — 3 warnings = auto-kick (admin only)' },
    { command: 'mute',       description: 'Mute a user (admin only)' },
    { command: 'unmute',     description: 'Unmute a user (admin only)' },
    { command: 'unban',      description: 'Unban a user (admin only)' },
    { command: 'warnings',   description: 'Check warnings for a user' },
    { command: 'modlog',     description: 'View recent moderation actions (admin only)' },
    { command: 'addadmin',   description: 'Add an admin or moderator (admin only)' },
    { command: 'removeadmin',description: 'Remove an admin (admin only)' },
    { command: 'admins',     description: 'List all admins' },
    // Fun
    // Custom commands
    // RSS
    { command: 'rss', description: 'Manage RSS news feeds' },
    // Calendar
    { command: 'calendar', description: 'View and manage events' },
    { command: 'rsvp',     description: 'Toggle attendance for an event' },
    // Custom commands
    { command: 'customcommands', description: 'List all custom commands' },
    { command: 'addcommand',   description: 'Create a custom command' },
    { command: 'editcommand',  description: 'Edit a custom command' },
    { command: 'removecommand',description: 'Delete a custom command' },
    // Fun
    { command: 'ping',       description: 'Test the bot' },
    { command: 'help',       description: 'Show all available commands' },
  ];

  // Register commands on every configured channel token
  // Pace registrations to avoid hitting Haven's 30 req/min rate limit
  const allTokens = channelManager.getAllTokens();
  const RATE_LIMIT  = 25;          // stay under 30/min with headroom
  const DELAY_MS    = 61000;       // wait just over 1 minute before next batch
  const CMD_GAP_MS  = 100;         // small gap between individual commands

  console.log(`📋 Registering slash commands on ${allTokens.length} channel(s)...`);

  let requestCount = 0;

  for (const { token, channelName } of allTokens) {
    console.log(`   → ${channelName} (callback: ${channelManager.getCallbackUrl(token) || 'none'})`);

    for (const { command, description } of commandList) {
      // If approaching rate limit, pause until window resets
      if (requestCount > 0 && requestCount % RATE_LIMIT === 0) {
        console.log(`   ⏳ Rate limit pause — waiting ${DELAY_MS / 1000}s...`);
        await new Promise(r => setTimeout(r, DELAY_MS));
      }

      try {
        await bot.registerCommand(command, description, token);
        requestCount++;
        // Small gap between commands to smooth out the request rate
        await new Promise(r => setTimeout(r, CMD_GAP_MS));
      } catch (err) {
        console.error(`   ⚠️  Failed to register /${command} on ${channelName}:`, err.message);
      }
    }
  }
  console.log(`✅ Registered ${commandList.length} commands on ${allTokens.length} channel(s)`);

  // Update each webhook's callback URL in Haven to use the per-token path
  // This ensures Haven POSTs to /cb/<token> so we can identify the source channel
  if (allTokens.length > 1 && process.env.CALLBACK_URL) {
    console.log('🔗 Updating webhook callback URLs in Haven...');
    for (const { token, channelName } of allTokens) {
      const callbackUrl = channelManager.getCallbackUrl(token);
      try {
        await bot._safeRequest('PATCH', `/api/webhooks/${token}`, {
          callback_url: callbackUrl,
        });
        console.log(`   ✅ ${channelName} → ${callbackUrl}`);
      } catch (err) {
        // PATCH may not be supported — log but continue
        console.log(`   ℹ️  ${channelName}: could not auto-update callback URL (${err.message})`);
        console.log(`      Set manually in Haven Bot Management: ${callbackUrl}`);
      }
    }
  }

  // Send startup greeting to all configured channels
  const greeting = process.env.BOT_GREETING ||
    `👋 **Haven Bot is online!**\n\nType \`/help\` to see what I can do.`;

  const greetingDeleteSecs = parseInt(process.env.HELP_DELETE_SECONDS || '0', 10);

  for (const { token, channelName } of channelManager.getAllTokens()) {
    try {
      const greetMsg = await bot._safeRequest('POST', `/api/webhooks/${token}/`, { content: greeting });
      // Auto-delete startup greeting after same delay as /help (HELP_DELETE_SECONDS)
      if (greetingDeleteSecs > 0 && greetMsg && greetMsg.message_id) {
        setTimeout(async () => {
          try {
            await bot._safeRequest('DELETE', `/api/webhooks/${token}/messages/${greetMsg.message_id}`);
          } catch (err) {
            console.error(`Failed to delete greeting in ${channelName}:`, err.message);
          }
        }, greetingDeleteSecs * 1000);
      }
    } catch (err) {
      console.error(`Failed to send welcome to ${channelName}:`, err.message);
    }
  }

  process.on('SIGINT',  () => { console.log('\n👋 Shutting down...'); bot.destroy(); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n👋 Shutting down...'); bot.destroy(); process.exit(0); });
}

main().catch(console.error);

module.exports = bot;