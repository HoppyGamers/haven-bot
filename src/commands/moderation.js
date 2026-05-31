const { admins, bans, warnings, mutes, modLogs, users: dbUsers, db } = require('../database');
const { checkAchievements, formatUnlockAnnouncement, getGlobalRank, getTotalMessages } = require('../achievements');
const { isAdmin } = require('../utils/permissions');

/**
 * Normalize the command data shape coming from index.js.
 */
function parseData(data) {
  return {
    userId:    data.user_id.toString(),
    username:  data.user,
    channelId: data.channel_id,
    args:      data.args || [],
  };
}


/**
 * Call a Haven moderation endpoint via the webhook token.
 * Returns { success: true } or throws with the error message.
 */
async function havenModRequest(bot, endpoint, body) {
  return bot._safeRequest('POST', `/api/webhooks/${bot.token}/moderation/${endpoint}`, body);
}

// ---------------------------------------------------------------------------
// /addadmin [@user] [role]
// ---------------------------------------------------------------------------
async function addadmin(bot, data) {
  const { userId, username, args } = parseData(data);

  const existingAdmins = admins.getAll();
  const isFirstAdmin = existingAdmins.length === 0;

  if (!isFirstAdmin && !isAdmin(userId)) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can add new admins.`);
  }

  const targetUsername = args[0] ? args[0].replace('@', '') : username;
  const role = (args[1] || 'moderator').toLowerCase();

  if (!['moderator', 'admin'].includes(role)) {
    return bot.sendMessage(`❌ **Invalid Role**\nRole must be \`moderator\` or \`admin\`.`);
  }

  // Resolve the target's real Haven user_id.
  // If adding themselves: we have the real numeric ID from the command payload.
  // If adding someone else by @username: look them up in the users table.
  // If they haven't interacted yet, fall back to lowercased username as a
  // temporary key — it will work as long as isAdmin() uses the same value.
  let targetUserId;
  if (targetUsername.toLowerCase() === username.toLowerCase()) {
    targetUserId = userId; // their own real ID
  } else {
    const userRecord = dbUsers.findByUsername(targetUsername);
    targetUserId = userRecord ? userRecord.user_id : targetUsername.toLowerCase();
  }

  if (admins.isAdmin(targetUserId)) {
    return bot.sendMessage(`⚠️ **Already Admin**\n${targetUsername} is already an admin.`);
  }

  const result = admins.add(targetUserId, targetUsername, role, username);
  if (!result) {
    return bot.sendMessage(`❌ **Failed**\nCould not add ${targetUsername} as admin. Check the logs.`);
  }

  const msg = isFirstAdmin
    ? `✅ **First Admin Added**\n**${targetUsername}** is now the first admin (${role}).`
    : `✅ **Admin Added**\n**${targetUsername}** is now an admin (${role}).`;

  return bot.sendMessage(msg);
}

// ---------------------------------------------------------------------------
// /admins
// ---------------------------------------------------------------------------
async function listAdmins(bot, data) {
  const allAdmins = admins.getAll();

  if (allAdmins.length === 0) {
    return bot.sendMessage(
      `ℹ️ **No Admins**\nNo admins have been configured yet.\nUse \`/addadmin\` to add the first admin.`
    );
  }

  let message = `👮 **Admins** (${allAdmins.length})\n`;
  allAdmins.forEach((admin) => {
    const roleEmoji = admin.role === 'admin' ? '👑' : '🛡️';
    message += `\n${roleEmoji} **${admin.username}** (${admin.role})\n*Added by: ${admin.added_by || 'system'}*`;
  });

  return bot.sendMessage(message);
}

// ---------------------------------------------------------------------------
// /ban @user [reason...]
// ---------------------------------------------------------------------------
async function ban(bot, data) {
  const { userId, username, channelId, args } = parseData(data);

  if (!isAdmin(userId)) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can ban users.`);
  }

  if (!args[0]) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/ban @username reason\``);
  }

  const targetUsername = args[0].replace('@', '');
  const targetUserId   = resolveUserId(targetUsername);
  const reason         = args.slice(1).join(' ') || 'No reason provided';

  if (bans.isBanned(targetUserId)) {
    return bot.sendMessage(`⚠️ **Already Banned**\n${targetUsername} is already banned.`);
  }

  // Call Haven ban API
  let banned = false;
  let apiError = null;
  try {
    await havenModRequest(bot, 'ban', { userId: targetUserId, reason });
    banned = true;
  } catch (err) {
    apiError = err.message;
    console.error('[ban] Haven API error:', err.message);
  }

  bans.add(targetUserId, targetUsername, reason, username);
  modLogs.log(channelId, 'ban', targetUserId, username, reason);

  if (banned) {
    return bot.sendMessage(
      `🔨 **User Banned**\n**${targetUsername}** has been banned from the server.\n**Reason:** ${reason}`
    );
  } else {
    return bot.sendMessage(
      `⚠️ **Ban Failed**\n` +
      `Couldn't ban **${targetUsername}** via Haven API.\n` +
      `**Reason:** ${reason}\n*Error: ${apiError}*\n\n` +
      `*Tip: Make sure \`can_moderate\` is enabled on this bot in Haven's Bot Management settings.*`
    );
  }
}

// ---------------------------------------------------------------------------
// /kick @user [reason...]
// ---------------------------------------------------------------------------
async function kick(bot, data) {
  const { userId, username, channelId, args } = parseData(data);

  if (!isAdmin(userId)) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can kick users.`);
  }

  if (!args[0]) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/kick @username reason\``);
  }

  const targetUsername = args[0].replace('@', '');
  const targetUserId   = resolveUserId(targetUsername);
  const reason         = args.slice(1).join(' ') || 'No reason provided';

  // Call Haven kick API
  let kicked = false;
  let apiError = null;
  try {
    await havenModRequest(bot, 'kick', { userId: targetUserId, channelCode: channelId, reason });
    kicked = true;
  } catch (err) {
    apiError = err.message;
    console.error('[kick] Haven API error:', err.message);
  }

  modLogs.log(channelId, 'kick', targetUserId, username, reason);

  if (kicked) {
    return bot.sendMessage(
      `👢 **User Kicked**\n**${targetUsername}** has been kicked from the channel.\n**Reason:** ${reason}`
    );
  } else {
    return bot.sendMessage(
      `⚠️ **Kick Recorded (Action May Have Failed)**\n` +
      `**${targetUsername}** was logged as kicked but the Haven API returned an error.\n` +
      `**Reason:** ${reason}\n` +
      `*Error: ${apiError} — you may need to remove them manually.*`
    );
  }
}

// ---------------------------------------------------------------------------
// /warn @user [reason...]   — 3 warnings → auto-kick
// ---------------------------------------------------------------------------
async function warn(bot, data) {
  const { userId, username, channelId, args } = parseData(data);

  if (!isAdmin(userId)) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can warn users.`);
  }

  if (!args[0]) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/warn @username reason\``);
  }

  const targetUsername = args[0].replace('@', '');
  const targetUserId   = resolveUserId(targetUsername);
  const reason         = args.slice(1).join(' ') || 'No reason provided';

  warnings.add(targetUserId, channelId, reason, username, targetUsername);
  const warnCount = warnings.getCount(targetUserId, channelId);
  modLogs.log(channelId, 'warn', targetUserId, username, reason);

  // Check if target earns the 'warned' achievement
  try {
    const targetUser = dbUsers.get(targetUserId);
    if (targetUser) {
      const unlocked = checkAchievements(db, targetUserId, targetUser.username, {
        totalMessages: getTotalMessages(db, targetUserId),
        globalLevel:   targetUser.level,
        streak:        targetUser.daily_streak || 0,
        globalRank:    getGlobalRank(db, targetUserId),
        modEvent:      'warned',
      });
      if (unlocked.length > 0) {
        await bot.sendMessage(formatUnlockAnnouncement(targetUser.username, unlocked));
      }
    }
  } catch (err) {
    console.error('[warn] Achievement check error:', err.message);
  }

  let message = `⚠️ **Warning Issued**\n**${targetUsername}** has been warned.\n**Reason:** ${reason}\n**Warnings:** ${warnCount}/3`;

  if (warnCount >= 3) {
    // Auto-kick via Haven API on 3rd warning
    let autoKicked = false;
    try {
      await havenModRequest(bot, 'kick', { userId: targetUserId, channelCode: channelId, reason: 'Auto-kicked: 3 warnings' });
      autoKicked = true;
    } catch (err) {
      console.error('[warn] Auto-kick API error:', err.message);
    }
    const kickNote = autoKicked
      ? `🔨 **Auto-Kicked:** User reached 3 warnings and has been removed from the channel.`
      : `🔨 **Auto-Kick Recorded:** User reached 3 warnings. Haven API failed — remove them manually.`;
    message += `\n\n${kickNote}`;
    modLogs.log(channelId, 'kick', targetUserId, 'system', 'Auto-kicked: 3 warnings');
    warnings.clearWarnings(targetUserId, channelId);
  }

  return bot.sendMessage(message);
}

// ---------------------------------------------------------------------------
// /mute @user [duration] [reason...]
// ---------------------------------------------------------------------------
async function mute(bot, data) {
  const { userId, username, channelId, args } = parseData(data);

  if (!isAdmin(userId)) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can mute users.`);
  }

  if (!args[0]) {
    return bot.sendMessage(
      `❌ **Invalid Command**\nUsage: \`/mute @username [duration] reason\`\nDuration examples: \`30m\`, \`2h\`, \`1d\` (default: 1h)`
    );
  }

  const targetUsername = args[0].replace('@', '');
  const targetUserId   = resolveUserId(targetUsername);

  let durationMinutes  = 60;
  let reasonStartIndex = 1;

  if (args[1] && args[1].match(/^\d+[mhd]$/i)) {
    durationMinutes  = parseDuration(args[1]);
    reasonStartIndex = 2;
  }

  const reason = args.slice(reasonStartIndex).join(' ') || 'No reason provided';

  if (mutes.isActive(targetUserId, channelId)) {
    return bot.sendMessage(`⚠️ **Already Muted**\n${targetUsername} is already muted in this channel.`);
  }

  mutes.add(targetUserId, channelId, reason, username, durationMinutes, targetUsername);
  modLogs.log(channelId, 'mute', targetUserId, username, reason, durationMinutes);

  // Check if target earns the 'muted' achievement
  try {
    const targetUser = dbUsers.get(targetUserId);
    if (targetUser) {
      const unlocked = checkAchievements(db, targetUserId, targetUser.username, {
        totalMessages: getTotalMessages(db, targetUserId),
        globalLevel:   targetUser.level,
        streak:        targetUser.daily_streak || 0,
        globalRank:    getGlobalRank(db, targetUserId),
        modEvent:      'muted',
      });
      if (unlocked.length > 0) {
        await bot.sendMessage(formatUnlockAnnouncement(targetUser.username, unlocked));
      }
    }
  } catch (err) {
    console.error('[mute] Achievement check error:', err.message);
  }

  // Call Haven mute API
  let muted = false;
  let muteApiError = null;
  try {
    await havenModRequest(bot, 'mute', { userId: targetUserId, duration: durationMinutes, reason });
    muted = true;
  } catch (err) {
    muteApiError = err.message;
    console.error('[mute] Haven API error:', err.message);
  }

  if (muted) {
    return bot.sendMessage(
      `🔇 **User Muted**\n**${targetUsername}** has been muted for **${formatDuration(durationMinutes)}**.\n**Reason:** ${reason}`
    );
  } else {
    return bot.sendMessage(
      `⚠️ **Mute Failed**\n` +
      `Couldn't mute **${targetUsername}** via Haven API.\n` +
      `**Reason:** ${reason}\n*Error: ${muteApiError}*\n\n` +
      `*Tip: Make sure \`can_moderate\` is enabled on this bot in Haven's Bot Management settings.*`
    );
  }
}

// ---------------------------------------------------------------------------
// /unmute @user
// ---------------------------------------------------------------------------
async function unmute(bot, data) {
  const { userId, username, channelId, args } = parseData(data);

  if (!isAdmin(userId)) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can unmute users.`);
  }

  if (!args[0]) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/unmute @username\``);
  }

  const targetUsername = args[0].replace('@', '');
  const targetUserId   = resolveUserId(targetUsername);

  if (!mutes.isActive(targetUserId, channelId)) {
    return bot.sendMessage(`⚠️ **Not Muted**\n${targetUsername} is not muted in this channel.`);
  }

  // Call Haven unmute API
  let unmuted = false;
  let unmuteApiError = null;
  try {
    await havenModRequest(bot, 'unmute', { userId: targetUserId });
    unmuted = true;
  } catch (err) {
    unmuteApiError = err.message;
    console.error('[unmute] Haven API error:', err.message);
  }

  mutes.remove(targetUserId, channelId);
  modLogs.log(channelId, 'unmute', targetUserId, username, 'Unmuted');

  if (unmuted) {
    return bot.sendMessage(`🔊 **User Unmuted**\n**${targetUsername}** has been unmuted.`);
  } else {
    return bot.sendMessage(
      `⚠️ **Unmute Failed**\n` +
      `Couldn't unmute **${targetUsername}** via Haven API.\n*Error: ${unmuteApiError}*\n\n` +
      `*Tip: Make sure \`can_moderate\` is enabled on this bot in Haven's Bot Management settings.*`
    );
  }
}

// ---------------------------------------------------------------------------
// /unban @user
// ---------------------------------------------------------------------------
async function unban(bot, data) {
  const { userId, username, channelId, args } = parseData(data);

  if (!isAdmin(userId)) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can unban users.`);
  }

  if (!args[0]) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/unban @username\``);
  }

  const targetUsername = args[0].replace('@', '');
  const targetUserId   = resolveUserId(targetUsername);

  if (!bans.isBanned(targetUserId)) {
    return bot.sendMessage(`⚠️ **Not Banned**\n${targetUsername} is not currently banned.`);
  }

  // Call Haven unban API
  let unbanned = false;
  let unbanApiError = null;
  try {
    await havenModRequest(bot, 'unban', { userId: targetUserId });
    unbanned = true;
  } catch (err) {
    unbanApiError = err.message;
    console.error('[unban] Haven API error:', err.message);
  }

  bans.remove(targetUserId);
  modLogs.log(channelId, 'unban', targetUserId, username, 'Unbanned');

  if (unbanned) {
    return bot.sendMessage(`✅ **User Unbanned**\n**${targetUsername}** has been unbanned from the server.`);
  } else {
    return bot.sendMessage(
      `⚠️ **Unban Failed**\n` +
      `Couldn't unban **${targetUsername}** via Haven API.\n*Error: ${unbanApiError}*\n\n` +
      `*Tip: Make sure \`can_moderate\` is enabled on this bot in Haven's Bot Management settings.*`
    );
  }
}

// ---------------------------------------------------------------------------
// /warnings [@user]
// ---------------------------------------------------------------------------
async function getWarnings(bot, data) {
  const { userId, username, channelId, args } = parseData(data);

  const targetUsername = args[0] ? args[0].replace('@', '') : null;
  const targetUserId   = targetUsername ? resolveUserId(targetUsername) : userId;
  const displayName    = targetUsername || 'You';

  const userWarnings = warnings.getWarnings(targetUserId, channelId);

  if (userWarnings.length === 0) {
    return bot.sendMessage(`✅ **No Warnings**\n${displayName} have no warnings in this channel.`);
  }

  let message = `⚠️ **Warnings for ${displayName}** (${userWarnings.length}/3)\n`;
  userWarnings.forEach((w, index) => {
    const date = new Date(w.issued_at).toLocaleDateString();
    message += `\n**${index + 1}.** ${w.reason}\n*Issued by: ${w.mod_user_id} on ${date}*`;
  });

  return bot.sendMessage(message);
}

// ---------------------------------------------------------------------------
// /modlog
// ---------------------------------------------------------------------------
async function modlog(bot, data) {
  const { userId, username, channelId } = parseData(data);

  if (!isAdmin(userId)) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can view the modlog.`);
  }

  const logs = modLogs.getLogs(channelId, 20);

  if (logs.length === 0) {
    return bot.sendMessage(`📋 **Moderation Log**\nNo moderation actions recorded in this channel.`);
  }

  let message = `📋 **Recent Moderation Actions** (Last ${logs.length})\n`;
  logs.forEach((log) => {
    const date = new Date(log.timestamp).toLocaleDateString();
    message += `\n**${log.action.toUpperCase()}** → ${log.target_user_id || 'Unknown'}\n`;
    message += `*By: ${log.mod_user_id || 'system'} | ${log.reason || 'No reason'} | ${date}*`;
  });

  return bot.sendMessage(message);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a target username to their stored user_id.
 * Falls back to lowercased username if they're not in the users table yet
 * (e.g. being banned before they've used the bot).
 */
function resolveUserId(username) {
  const record = dbUsers.findByUsername(username);
  return record ? record.user_id : username.toLowerCase();
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([mhd])$/i);
  if (!match) return 60;
  const n = parseInt(match[1]);
  switch (match[2].toLowerCase()) {
    case 'm': return n;
    case 'h': return n * 60;
    case 'd': return n * 60 * 24;
    default:  return 60;
  }
}

function formatDuration(minutes) {
  if (minutes < 60)   return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}


// ---------------------------------------------------------------------------
// /removeadmin @user  — FIX #7
// ---------------------------------------------------------------------------
async function removeadmin(bot, data) {
  const { userId, username, args } = parseData(data);

  if (!isAdmin(userId)) {
    return bot.sendMessage(`❌ **Permission Denied**\nOnly admins can remove admins.`);
  }

  if (!args[0]) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/removeadmin @username\``);
  }

  const targetUsername = args[0].replace('@', '');
  const userRecord = dbUsers.findByUsername(targetUsername);
  const targetUserId = userRecord ? userRecord.user_id : targetUsername.toLowerCase();

  if (!admins.isAdmin(targetUserId)) {
    return bot.sendMessage(`⚠️ **Not an Admin**\n${targetUsername} is not currently an admin.`);
  }

  if (targetUserId === userId) {
    return bot.sendMessage(`❌ **Cannot Remove Self**\nYou cannot remove yourself as admin.`);
  }

  admins.remove(targetUserId);
  return bot.sendMessage(`✅ **Admin Removed**\n**${targetUsername}** has been removed as admin.`);
}

module.exports = {
  addadmin,
  removeadmin,
  listAdmins,
  ban,
  kick,
  warn,
  mute,
  unmute,
  unban,
  getWarnings,
  modlog,
};
