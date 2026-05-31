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

  // Award XP and check achievements
  // FIX #1: skip XP for moderation/admin/daily commands (daily handles its own)
  // FIX #2: skip achievement checks for commands that can't change rank/messages
  const skipXp          = ['ban','kick','warn','mute','unmute','unban','warnings','modlog','addadmin','removeadmin','admins','addcommand','editcommand','removecommand','daily','calendar','rss'].includes(command);
  const skipAchievements = ['help','ping','sounds','stopsound','commands','customcommands','profile','leaderboard','top','calendar','rss'].includes(command);

  try {
    const userId = data.user_id.toString();
    const existingUser = users.get(userId);
    users.getOrCreate(userId, user);
    channels.getOrCreate(data.channel_id, 'Channel');

    // FIX 13: first-time user greeting
    if (!existingUser) {
      const defaultGreeting = `👋 Welcome to the server, **${user}**! Type \`/help\` to see what I can do.`;
      const greeting = (process.env.BOT_FIRST_TIME_GREETING || defaultGreeting)
        .replace(/\{user\}/gi, user);
      await bot.sendMessage(greeting);
    }

    if (!skipXp && !isOnXpCooldown(userId)) {
      setXpCooldown(userId);
      const xpResult = stats.addMessage(userId, data.channel_id, 10);
      // FIX 7: announce level up mid-conversation
      if (xpResult && xpResult.leveledUp) {
        await bot.sendMessage(
          `🎉 **Level Up!** **${user}** reached level ${xpResult.newLevel}!`
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
        await bot.sendMessage(announcement);
      }
    }
  } catch (err) {
    console.error('Error tracking XP/achievements:', err.message);
  }

  // args is pre-parsed by bot.js from Haven's slash_command payload.
  // Fall back to parsing raw_content for legacy message events.
  const enrichedData = {
    ...data,
    args: data.args && data.args.length > 0
      ? data.args
      : (data.raw_content || '').trim().split(/\s+/).slice(1).filter(Boolean),
  };

  try {
  switch (command) {
    // --- Profile commands ---
    case 'ping':
      await bot.sendMessage(`🏓 Pong! ${user} just pinged me!`);
      break;

    case 'profile':
      await bot.advancedCommands.profile(bot, enrichedData);
      break;

    case 'level':
      await bot.advancedCommands.level(bot, enrichedData);
      break;

    case 'stats':
      await bot.advancedCommands.stats(bot, enrichedData);
      break;

    case 'leaderboard':
      await bot.advancedCommands.leaderboard(bot, enrichedData);
      break;

    case 'daily':
      await bot.advancedCommands.daily(bot, enrichedData);
      break;

    case 'top':
      await bot.advancedCommands.top(bot, enrichedData);
      break;

    // --- Moderation commands ---
    case 'addadmin':
      await moderationCommands.addadmin(bot, enrichedData);
      break;

    case 'admins':
      await moderationCommands.listAdmins(bot, enrichedData);
      break;

    case 'removeadmin':
      await moderationCommands.removeadmin(bot, enrichedData);
      break;

    case 'ban':
      await moderationCommands.ban(bot, enrichedData);
      break;

    case 'kick':
      await moderationCommands.kick(bot, enrichedData);
      break;

    case 'warn':
      await moderationCommands.warn(bot, enrichedData);
      break;

    case 'mute':
      await moderationCommands.mute(bot, enrichedData);
      break;

    case 'unmute':
      await moderationCommands.unmute(bot, enrichedData);
      break;

    case 'unban':
      await moderationCommands.unban(bot, enrichedData);
      break;

    case 'warnings':
      await moderationCommands.getWarnings(bot, enrichedData);
      break;

    case 'modlog':
      await moderationCommands.modlog(bot, enrichedData);
      break;

    // --- Music / Soundboard ---
    case 'soundboard':
      await soundboardCommands.soundboard(bot, enrichedData);
      break;

    case 'sounds':
      await soundboardCommands.sounds(bot, enrichedData);
      break;

    case 'stopsound':
      await soundboardCommands.stopsound(bot, enrichedData);
      break;

    // --- Custom command management ---
    case 'addcommand':
      await customCommands.addcommand(bot, enrichedData);
      break;

    case 'editcommand':
      await customCommands.editcommand(bot, enrichedData);
      break;

    case 'removecommand':
      await customCommands.removecommand(bot, enrichedData);
      break;

    case 'commands':
    case 'customcommands':
      await customCommands.listCommands(bot, enrichedData);
      break;

    // --- Calendar ---
    case 'calendar':
      await calendarCommands.calendarRouter(bot, enrichedData);
      break;

    case 'rsvp':
      await calendarCommands.rsvp(bot, enrichedData);
      break;

    // --- RSS ---
    case 'rss':
      await rssCommands.rssRouter(bot, enrichedData);
      break;

    // --- Help ---
    case 'help':
      await bot.sendMessage(`
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
\`/rss check\` - Check for new items now (admin)

**Calendar:**
\`/calendar list\` - Upcoming events
\`/calendar add <date> <time> <title>\` - Create event (admin)
\`/rsvp <id>\` - Toggle attendance

**Custom Commands:**
\`/customcommands\` - List all custom commands
*(Use \`/addcommand\`, \`/editcommand\`, \`/removecommand\` to manage)*

**Fun:**
\`/ping\` - Test the bot
\`/help\` - This message
      `.trim());
      break;

    default: {
      // Check if it's a custom command before reporting unknown
      const customCmd = customCommandsDb.get(command);
      if (customCmd) {
        await customCommands.executeCustomCommand(bot, enrichedData, customCmd);
      } else {
        await bot.sendMessage(
          `❓ Unknown command: \`/${command}\`. Type \`/help\` for available commands.`
        );
      }
    }
  }
  } catch (err) {
    // Log the full error so it's visible in the console, but don't crash
    console.error(`❌ Error handling /${command}:`, err);
    try {
      await bot.sendMessage(
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

  console.log('📋 Registering slash commands with Haven...');
  for (const { command, description } of commandList) {
    try {
      await bot.registerCommand(command, description);
    } catch (err) {
      console.error(`   ⚠️  Failed to register /${command}:`, err.message);
    }
  }
  console.log(`✅ Registered ${commandList.length} commands`);

  // FIX 13: configurable startup greeting via BOT_GREETING env var
  const greeting = process.env.BOT_GREETING ||
    `👋 **Haven Bot is online!**\n\nType \`/help\` to see what I can do.`;

  try {
    await bot.sendMessage(greeting);
  } catch (err) {
    console.error('Failed to send welcome message:', err.message);
    console.log('(Expected if the bot is not yet fully configured.)');
  }

  process.on('SIGINT',  () => { console.log('\n👋 Shutting down...'); bot.destroy(); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n👋 Shutting down...'); bot.destroy(); process.exit(0); });
}

main().catch(console.error);

module.exports = bot;
