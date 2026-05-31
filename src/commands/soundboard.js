// ---------------------------------------------------------------------------
// Music / Soundboard commands
// ...
// ---------------------------------------------------------------------------

function getSoundList() {
  const raw = process.env.SOUNDS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * /soundboard <sound name>
 * Plays the named soundboard sound for everyone in the channel.
 */
async function soundboard(bot, data) {
  const args     = data.args || [];
  const soundName = args.join(' ').trim();

  if (!soundName) {
    return bot.sendMessage(
      `❌ **Invalid Command**\nUsage: \`/soundboard <sound name>\`\nTip: Use \`/sounds\` to see available sounds.`
    );
  }

  try {
    await bot.playSound(soundName);
    return bot.sendMessage(`🔊 Now playing: **${soundName}**`);
  } catch (err) {
    // Haven returns an error if the sound name doesn't match exactly
    if (err.message.includes('404') || err.message.includes('not found')) {
      return bot.sendMessage(
        `❌ **Sound Not Found**\n\`${soundName}\` doesn't match any sound on this server.\nUse \`/sounds\` to see the full list.`
      );
    }
    console.error('[soundboard] Error:', err.message);
    return bot.sendMessage(`⚠️ **Error**\nCouldn't play that sound: ${err.message}`);
  }
}

/**
 * /sounds
 * Lists all available soundboard sounds on the server.
 */
async function sounds(bot, data) {
  const soundList = getSoundList();

  if (soundList.length === 0) {
    return bot.sendMessage(
      `🔇 **No Sounds Configured**\n` +
      `Add your server's sound names to \`.env\`:\n` +
      `\`SOUNDS=AOL - You've Got Mail,Airhorn,Sad Trombone\`\n\n` +
      `You can find sound names in Haven's soundboard settings.`
    );
  }

  let message = `🎵 **Available Sounds (${soundList.length})**\n\n`;
  message += soundList.map(n => `• ${n}`).join('\n');

  if (message.length > 3800) {
    message = message.slice(0, 3800) + `\n\n*...and more. Use \`/soundboard <name>\` to play any sound.*`;
  } else {
    message += `\n\nUse \`/soundboard <name>\` to play a sound.`;
  }

  return bot.sendMessage(message);
}

/**
 * /stopsound
 * Haven doesn't currently have a stop endpoint — inform the user.
 */
async function stopsound(bot, data) {
  return bot.sendMessage(
    `ℹ️ **Stop Not Supported**\nHaven doesn't currently support stopping a sound via the bot API. Sounds play to completion automatically.`
  );
}

module.exports = { soundboard, sounds, stopsound };
