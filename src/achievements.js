// ---------------------------------------------------------------------------
// Achievement definitions — single source of truth
// ---------------------------------------------------------------------------
const ACHIEVEMENTS = [
  // 📨 Message milestones
  { key: 'first_message', category: 'messages', name: 'First Steps',  description: 'Send your first message',       xp: 50,   icon: '👣' },
  { key: 'chatterbox',    category: 'messages', name: 'Chatterbox',   description: 'Send 100 messages',             xp: 100,  icon: '💬' },
  { key: 'regular',       category: 'messages', name: 'Regular',      description: 'Send 500 messages',             xp: 250,  icon: '📨' },
  { key: 'veteran',       category: 'messages', name: 'Veteran',      description: 'Send 1000 messages',            xp: 500,  icon: '🎖️' },

  // ⭐ Level milestones
  { key: 'level_5',  category: 'levels', name: 'Rising Star', description: 'Reach level 5',  xp: 100,  icon: '🌟' },
  { key: 'level_10', category: 'levels', name: 'Seasoned',    description: 'Reach level 10', xp: 250,  icon: '⭐' },
  { key: 'level_25', category: 'levels', name: 'Elite',       description: 'Reach level 25', xp: 500,  icon: '💫' },
  { key: 'level_50', category: 'levels', name: 'Legend',      description: 'Reach level 50', xp: 1000, icon: '🌠' },

  // 📅 Daily streak
  { key: 'streak_3',  category: 'streak', name: 'Consistent', description: 'Claim daily bonus 3 days in a row',  xp: 100,  icon: '🔥' },
  { key: 'streak_7',  category: 'streak', name: 'Dedicated',  description: 'Claim daily bonus 7 days in a row',  xp: 250,  icon: '🔥' },
  { key: 'streak_30', category: 'streak', name: 'Devoted',    description: 'Claim daily bonus 30 days in a row', xp: 1000, icon: '🔥' },

  // 🛡️ Moderation (no XP — cautionary badges)
  { key: 'warned', category: 'moderation', name: 'Warned',   description: 'Receive your first warning', xp: 0, icon: '⚠️' },
  { key: 'muted',  category: 'moderation', name: 'Silenced', description: 'Receive a mute',             xp: 0, icon: '🔇' },

  // 🏆 Leaderboard
  { key: 'top_10', category: 'leaderboard', name: 'Top 10',   description: 'Reach the global top 10', xp: 150, icon: '🏅' },
  { key: 'top_3',  category: 'leaderboard', name: 'Podium',   description: 'Reach the global top 3',  xp: 300, icon: '🥉' },
  { key: 'top_1',  category: 'leaderboard', name: 'Champion', description: 'Reach #1 globally',       xp: 500, icon: '🏆' },
];

const ACHIEVEMENT_MAP = Object.fromEntries(ACHIEVEMENTS.map(a => [a.key, a]));

// ---------------------------------------------------------------------------
// Achievement engine
// Checks which achievements a user has newly earned and awards XP for each.
// Returns array of newly unlocked achievement objects.
// ---------------------------------------------------------------------------
function checkAchievements(db, userId, username, context = {}) {
  const { totalMessages = 0, globalLevel = 1, streak = 0, globalRank = null, modEvent = null } = context;

  const earned = db.prepare('SELECT achievement_key FROM user_achievements WHERE user_id = ?').all(userId).map(r => r.achievement_key);
  const earnedSet = new Set(earned);

  const newlyUnlocked = [];

  function unlock(key) {
    if (earnedSet.has(key)) return;
    const achievement = ACHIEVEMENT_MAP[key];
    if (!achievement) return;

    db.prepare('INSERT INTO user_achievements (user_id, achievement_key) VALUES (?, ?)').run(userId, key);

    // Award XP if applicable
    if (achievement.xp > 0) {
      db.prepare('UPDATE users SET xp = xp + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(achievement.xp, userId);
      // Recalculate level after XP award
      const user = db.prepare('SELECT xp, level FROM users WHERE user_id = ?').get(userId);
      const newLevel = Math.floor(user.xp / 100) + 1;
      if (newLevel !== user.level) {
        db.prepare('UPDATE users SET level = ? WHERE user_id = ?').run(newLevel, userId);
      }
    }

    newlyUnlocked.push(achievement);
    earnedSet.add(key);
  }

  // --- Message milestones ---
  if (totalMessages >= 1)    unlock('first_message');
  if (totalMessages >= 100)  unlock('chatterbox');
  if (totalMessages >= 500)  unlock('regular');
  if (totalMessages >= 1000) unlock('veteran');

  // --- Level milestones ---
  if (globalLevel >= 5)  unlock('level_5');
  if (globalLevel >= 10) unlock('level_10');
  if (globalLevel >= 25) unlock('level_25');
  if (globalLevel >= 50) unlock('level_50');

  // --- Daily streak ---
  if (streak >= 3)  unlock('streak_3');
  if (streak >= 7)  unlock('streak_7');
  if (streak >= 30) unlock('streak_30');

  // --- Leaderboard ---
  if (globalRank !== null) {
    if (globalRank <= 10) unlock('top_10');
    if (globalRank <= 3)  unlock('top_3');
    if (globalRank === 1) unlock('top_1');
  }

  // --- Moderation events ---
  if (modEvent === 'warned') unlock('warned');
  if (modEvent === 'muted')  unlock('muted');

  return newlyUnlocked;
}

// ---------------------------------------------------------------------------
// Get all earned achievements for a user, grouped by category
// ---------------------------------------------------------------------------
function getUserAchievements(db, userId) {
  const earned = db.prepare(
    'SELECT achievement_key, earned_at FROM user_achievements WHERE user_id = ? ORDER BY earned_at ASC'
  ).all(userId);

  const earnedMap = Object.fromEntries(earned.map(r => [r.achievement_key, r.earned_at]));

  const result = { messages: [], levels: [], streak: [], moderation: [], leaderboard: [] };
  for (const a of ACHIEVEMENTS) {
    if (earnedMap[a.key]) {
      result[a.category].push({ ...a, earned_at: earnedMap[a.key] });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Format newly unlocked achievements for chat announcement
// ---------------------------------------------------------------------------
function formatUnlockAnnouncement(username, achievements) {
  if (achievements.length === 0) return null;
  const lines = achievements.map(a =>
    `${a.icon} **${a.name}** — ${a.description}${a.xp > 0 ? ` (+${a.xp} XP)` : ''}`
  );
  return `🏆 **Achievement Unlocked!**\n**${username}** earned:\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Get a user's global rank (1-based)
// ---------------------------------------------------------------------------
function getGlobalRank(db, userId) {
  const result = db.prepare(`
    SELECT COUNT(*) + 1 as rank FROM users
    WHERE xp > (SELECT COALESCE(xp, 0) FROM users WHERE user_id = ?)
  `).get(userId);
  return result ? result.rank : null;
}

// ---------------------------------------------------------------------------
// Get total messages across all channels for a user
// ---------------------------------------------------------------------------
function getTotalMessages(db, userId) {
  const result = db.prepare(
    'SELECT COALESCE(SUM(messages), 0) as total FROM user_stats WHERE user_id = ?'
  ).get(userId);
  return result ? result.total : 0;
}

module.exports = {
  ACHIEVEMENTS,
  ACHIEVEMENT_MAP,
  checkAchievements,
  getUserAchievements,
  formatUnlockAnnouncement,
  getGlobalRank,
  getTotalMessages,
};
