const { users, channels, stats, db } = require('../database');
const { checkAchievements, getUserAchievements, formatUnlockAnnouncement, getGlobalRank, getTotalMessages, ACHIEVEMENTS } = require('../achievements');

module.exports = {

  // /profile [@user]
  profile: async (bot, data) => {
    const selfId       = data.user_id.toString();
    const selfUsername = data.user;

    // Allow /profile @someone
    const targetUsername = data.args && data.args[0] ? data.args[0].replace('@', '') : null;
    let profileUser;

    if (targetUsername) {
      profileUser = users.findByUsername(targetUsername);
      if (!profileUser) {
        await bot.sendMessage(`❌ User **${targetUsername}** not found.`);
        return;
      }
    } else {
      users.getOrCreate(selfId, selfUsername);
      profileUser = users.getProfile(selfId);
    }

    const userId   = profileUser.user_id;
    const username = profileUser.username;
    // Always fetch fresh profile to get latest XP/level/streak
    const profile  = users.getProfile(userId) || profileUser;

    const memberSince = new Date(profile.created_at).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const xpToNext = (profile.level * 100) - profile.xp;
    const streak   = profile.daily_streak || 0;

    // Achievements
    const earned     = getUserAchievements(db, userId);
    const totalEarned = Object.values(earned).reduce((sum, arr) => sum + arr.length, 0);
    const totalPossible = ACHIEVEMENTS.length;

    const formatCategory = (label, items) => {
      if (items.length === 0) return null;
      return `${label} ${items.map(a => `${a.icon} ${a.name}`).join(' • ')}`;
    };

    const achievementLines = [
      formatCategory('📨', earned.messages),
      formatCategory('⭐', earned.levels),
      formatCategory('🔥', earned.streak),
      formatCategory('🛡️', earned.moderation),
      formatCategory('🏆', earned.leaderboard),
    ].filter(Boolean);

    // Only show earned achievements — skip empty categories
    const achievementSection = totalEarned > 0
      ? `\n🏆 **Achievements (${totalEarned}/${totalPossible})**\n${achievementLines.join('\n')}`
      : `\n🏆 **Achievements (0/${totalPossible})**\n*No achievements yet!*`;

    await bot.sendMessage(
      `👤 **${username}'s Profile**\n\n` +
      `Level: ${profile.level}  •  XP: ${profile.xp}  •  Next level: ${xpToNext} XP\n` +
      `Daily Streak: ${streak > 0 ? `🔥 ${streak} day${streak !== 1 ? 's' : ''}` : 'None'}\n` +
      `Member Since: ${memberSince}` +
      achievementSection
    );
  },

  // /leaderboard — global XP leaderboard
  leaderboard: async (bot, data) => {
    const channelId = data.channel_id;
    channels.getOrCreate(channelId, 'Channel');

    const leaderboard = stats.getChannelLeaderboard(channelId, 10);
    const medals = ['🥇', '🥈', '🥉'];

    if (leaderboard.length === 0) {
      await bot.sendMessage(`🏆 **Global Leaderboard**\n\nNo users yet!`);
      return;
    }

    let message = `🏆 **Global Leaderboard (Top ${leaderboard.length})**\n\n`;
    leaderboard.forEach((entry, index) => {
      const prefix = medals[index] || `${index + 1}.`;
      message += `${prefix} **${entry.username}** — Level ${entry.level} (${entry.xp} XP)\n`;
    });

    await bot.sendMessage(message);
  },

  // /level — global level
  level: async (bot, data) => {
    const userId    = data.user_id.toString();
    const username  = data.user;
    const channelId = data.channel_id;

    const user     = users.getOrCreate(userId, username);
    channels.getOrCreate(channelId, 'Channel');
    const totalMsg = getTotalMessages(db, userId);
    const xpToNext = (user.level * 100) - user.xp;

    await bot.sendMessage(
      `📊 **${username}'s Level**\n\n` +
      `Level: ${user.level}\n` +
      `XP: ${user.xp}  •  Next level: ${xpToNext} XP\n` +
      `Total Messages: ${totalMsg}`
    );
  },

  // /stats — global XP with channel message breakdown
  stats: async (bot, data) => {
    const userId    = data.user_id.toString();
    const username  = data.user;
    const channelId = data.channel_id;

    const user = users.getOrCreate(userId, username);
    channels.getOrCreate(channelId, 'Channel');

    const { rank, total } = stats.getChannelRank(userId, channelId);
    const totalMessages   = getTotalMessages(db, userId);
    const totalUsers      = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    const earnedAchievements = db.prepare(
      'SELECT COUNT(*) as count FROM user_achievements WHERE user_id = ?'
    ).get(userId);
    const achievementCount = earnedAchievements ? earnedAchievements.count : 0;
    const achievementTotal = db.prepare('SELECT COUNT(*) as count FROM achievements').get().count;

    // Channel breakdown
    const breakdown = stats.getChannelBreakdown(userId);
    const breakdownLines = breakdown.length > 0
      ? breakdown.map(r => `• #${r.channel_name}: ${r.messages} messages`).join('\n')
      : '• No messages yet';

    await bot.sendMessage(
      `📈 **${username}'s Statistics**\n\n` +
      `**Global:**\n` +
      `• Level: ${user.level}  •  XP: ${user.xp}\n` +
      `• Rank: #${rank} of ${totalUsers}\n` +
      `• Total Messages: ${totalMessages}\n` +
      `• Achievements: ${achievementCount}/${achievementTotal}\n\n` +
      `**Channel Breakdown:**\n` +
      breakdownLines
    );
  },

  // /daily
  daily: async (bot, data) => {
    const userId    = data.user_id.toString();
    const username  = data.user;
    const channelId = data.channel_id;

    channels.getOrCreate(channelId, 'Channel');

    const { claimed, result, streak, previousStreak = 0 } = users.claimDaily(userId, username, 100);

    if (!claimed) {
      await bot.sendMessage(`❌ You already claimed your daily bonus today! Come back tomorrow.`);
      return;
    }

    // Note: stats.addMessage NOT called here — daily XP is global only,
    // not a channel message. Channel XP comes from actual command usage.

    let message = `🎁 **Daily Bonus Claimed!**\n\n+100 XP`;
    if (streak === 1 && previousStreak > 1) {
      // Streak was reset
      message += `\n💔 **Streak Reset** — you missed a day. Starting fresh at 🔥 1 day.`;
    } else if (streak === 1) {
      message += `\n🔥 Streak: 1 day — come back tomorrow to build it up!`;
    } else {
      message += `\n🔥 **Streak: ${streak} days** — keep it up!`;
    }
    if (result.leveledUp) message += `\n\n🎉 **Level Up!** You are now level ${result.newLevel}!`;

    // Check streak achievements
    const userRecord = users.get(userId);
    const unlocked = checkAchievements(db, userId, username, {
      totalMessages: getTotalMessages(db, userId),
      globalLevel:   userRecord ? userRecord.level : 1,
      streak:        streak || 0,
      globalRank:    getGlobalRank(db, userId),
    });

    if (unlocked.length > 0) {
      message += `\n\n${formatUnlockAnnouncement(username, unlocked)}`;
    }

    await bot.sendMessage(message);
  },

  // /top [limit] — global leaderboard with optional limit (default 10, max 25)
  top: async (bot, data) => {
    const requestedLimit = parseInt((data.args || [])[0]) || 10;
    const limit = Math.min(Math.max(requestedLimit, 1), 25);
    const leaderboard = users.getLeaderboard(limit);

    if (leaderboard.length === 0) {
      await bot.sendMessage(`🌟 **Global Leaderboard**\n\nNo users yet!`);
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    let message = `🌟 **Global Leaderboard (Top ${leaderboard.length})**\n\n`;
    leaderboard.forEach((entry, index) => {
      const prefix = medals[index] || `${index + 1}.`;
      message += `${prefix} **${entry.username}** — Level ${entry.level} (${entry.xp} XP)\n`;
    });
    message += `\nUse \`/leaderboard\` to see the channel leaderboard.`;
    if (limit !== 10) message += ` Use \`/top\` for the default top 10.`;

    await bot.sendMessage(message);
  },
};
