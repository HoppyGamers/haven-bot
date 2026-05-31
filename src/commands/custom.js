// ---------------------------------------------------------------------------
// Custom commands — admin/user created responses
//
// Permission controlled by CUSTOM_COMMANDS_PERMISSION in .env:
//   admin    — only users in admin_users table (default)
//   everyone — any user can create/edit/delete commands
//
// Supported variables in responses:
//   {user}    — username of whoever ran the command
//   {channel} — channel ID
//   {count}   — how many times this command has been used
//
// Commands:
//   /addcommand <name> <response>    — create a custom command
//   /editcommand <name> <response>   — edit an existing command
//   /removecommand <name>            — delete a command
//   /commands                        — list all custom commands
// ---------------------------------------------------------------------------

const { customCommands, admins } = require('../database');

// Built-in command names that cannot be overridden
const RESERVED = new Set([
  'help', 'ping', 'profile', 'level', 'stats', 'daily', 'leaderboard', 'top',
  'ban', 'kick', 'warn', 'mute', 'unmute', 'unban', 'warnings', 'modlog',
  'addadmin', 'removeadmin', 'admins',
  'soundboard', 'sounds', 'stopsound',
  'addcommand', 'editcommand', 'removecommand', 'commands',
]);

/**
 * Check if the user has permission to manage custom commands.
 */
function hasPermission(userId) {
  const setting = (process.env.CUSTOM_COMMANDS_PERMISSION || 'admin').toLowerCase();
  if (setting === 'everyone') return true;
  return admins.isAdmin(userId); // default: admin only
}

/**
 * Replace {user}, {channel}, {count} variables in a response string.
 */
function interpolate(response, context) {
  return response
    .replace(/\{user\}/gi,    context.user)
    .replace(/\{channel\}/gi, context.channelId)
    .replace(/\{count\}/gi,   String(context.count));
}

// ---------------------------------------------------------------------------
// /addcommand <name> <response...>
// ---------------------------------------------------------------------------
async function addcommand(bot, data) {
  const { user_id: userId, user, args = [] } = data;

  if (!hasPermission(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nYou don't have permission to create commands.`);
  }

  if (args.length < 2) {
    return bot.sendMessage(
      `❌ **Invalid Command**\nUsage: \`/addcommand <name> <response>\`\n` +
      `Example: \`/addcommand rules Be respectful and have fun!\`\n\n` +
      `Available variables: \`{user}\` \`{channel}\` \`{count}\``
    );
  }

  const name     = args[0].toLowerCase().replace(/^\//, '');
  const response = args.slice(1).join(' ');

  if (RESERVED.has(name)) {
    return bot.sendMessage(
      `❌ **Reserved Name**\n\`/${name}\` is a built-in command and cannot be overridden.`
    );
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    return bot.sendMessage(
      `❌ **Invalid Name**\nCommand names can only contain letters, numbers, and hyphens.\nExample: /addcommand my-command response here`
    );
  }

  if (name.length > 32) {
    return bot.sendMessage(`❌ **Name Too Long**\nCommand names must be 32 characters or fewer.`);
  }

  if (response.length > 2000) {
    return bot.sendMessage(`❌ **Response Too Long**\nResponses must be 2000 characters or fewer.`);
  }

  if (customCommands.exists(name)) {
    return bot.sendMessage(
      `⚠️ **Already Exists**\n\`/${name}\` already exists. Use \`/editcommand ${name} <new response>\` to update it.`
    );
  }

  const result = customCommands.create(name, response, user);
  if (!result) {
    return bot.sendMessage(`⚠️ **Failed**\nCouldn't create \`/${name}\`. Try again.`);
  }

  return bot.sendMessage(
    `✅ **Command Created**\n\`/${name}\` is now available.\n**Response:** ${response}`
  );
}

// ---------------------------------------------------------------------------
// /editcommand <name> <response...>
// ---------------------------------------------------------------------------
async function editcommand(bot, data) {
  const { user_id: userId, args = [] } = data;

  if (!hasPermission(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nYou don't have permission to edit commands.`);
  }

  if (args.length < 2) {
    return bot.sendMessage(
      `❌ **Invalid Command**\nUsage: \`/editcommand <name> <new response>\`\n` +
      `Example: \`/editcommand rules Updated rules here!\``
    );
  }

  const name     = args[0].toLowerCase().replace(/^\//, '');
  const response = args.slice(1).join(' ');

  if (RESERVED.has(name)) {
    return bot.sendMessage(`❌ **Reserved Name**\n\`/${name}\` is a built-in command and cannot be edited.`);
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    return bot.sendMessage(`❌ **Invalid Name**\nCommand names can only contain letters, numbers, and hyphens.`);
  }

  if (!customCommands.exists(name)) {
    return bot.sendMessage(
      `⚠️ **Not Found**\n\`/${name}\` doesn't exist. Use \`/addcommand ${name} <response>\` to create it.`
    );
  }

  if (response.length > 2000) {
    return bot.sendMessage(`❌ **Response Too Long**\nResponses must be 2000 characters or fewer.`);
  }

  customCommands.update(name, response);

  return bot.sendMessage(
    `✅ **Command Updated**\n\`/${name}\` has been updated.\n**New Response:** ${response}`
  );
}

// ---------------------------------------------------------------------------
// /removecommand <name>
// ---------------------------------------------------------------------------
async function removecommand(bot, data) {
  const { user_id: userId, args = [] } = data;

  if (!hasPermission(userId.toString())) {
    return bot.sendMessage(`❌ **Permission Denied**\nYou don't have permission to remove commands.`);
  }

  if (!args[0]) {
    return bot.sendMessage(`❌ **Invalid Command**\nUsage: \`/removecommand <name>\``);
  }

  const name = args[0].toLowerCase().replace(/^\//, '');

  if (RESERVED.has(name)) {
    return bot.sendMessage(`❌ **Reserved Name**\n\`/${name}\` is a built-in command and cannot be removed.`);
  }

  if (!customCommands.exists(name)) {
    return bot.sendMessage(`⚠️ **Not Found**\n\`/${name}\` doesn't exist.`);
  }

  customCommands.remove(name);

  return bot.sendMessage(`✅ **Command Removed**\n\`/${name}\` has been deleted.`);
}

// ---------------------------------------------------------------------------
// /commands
// Lists all custom commands
// ---------------------------------------------------------------------------
async function listCommands(bot, data) {
  const all = customCommands.getAll();

  if (all.length === 0) {
    return bot.sendMessage(
      `📋 **Custom Commands**\n\nNo custom commands yet.\n` +
      `Use \`/addcommand <name> <response>\` to create one.`
    );
  }

  let message = `📋 **Custom Commands (${all.length})**\n\n`;
  all.forEach(cmd => {
    message += `• \`/${cmd.name}\` — ${cmd.response.slice(0, 60)}${cmd.response.length > 60 ? '...' : ''}\n`;
  });

  if (message.length > 3800) {
    message = message.slice(0, 3800) + '\n*...and more.*';
  }

  return bot.sendMessage(message);
}

// ---------------------------------------------------------------------------
// Execute a custom command (called from index.js when command name matches)
// ---------------------------------------------------------------------------
async function executeCustomCommand(bot, data, cmdRecord) {
  customCommands.incrementUseCount(cmdRecord.name);

  const response = interpolate(cmdRecord.response, {
    user:      data.user,
    channelId: data.channel_id,
    count:     cmdRecord.use_count + 1,
  });

  return bot.sendMessage(response);
}

module.exports = {
  addcommand,
  editcommand,
  removecommand,
  listCommands,
  executeCustomCommand,
};
