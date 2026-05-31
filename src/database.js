const Database = require('better-sqlite3');
const path = require('path');

// DB_PATH env var lets Docker users mount a persistent volume.
// Falls back to the project root for local development.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'haven-bot.db');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      last_daily_claim DATETIME,
      daily_streak INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY,
      channel_id TEXT UNIQUE NOT NULL,
      channel_name TEXT,
      server_url TEXT,
      settings TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_stats (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      messages INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      last_xp_time DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (channel_id) REFERENCES channels(channel_id),
      UNIQUE(user_id, channel_id)
    )
  `);

  // FIX #9: added duration_minutes per PHASE2 spec
  db.exec(`
    CREATE TABLE IF NOT EXISTS mod_logs (
      id INTEGER PRIMARY KEY,
      channel_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_user_id TEXT,
      mod_user_id TEXT,
      reason TEXT,
      duration_minutes INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(channel_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      role TEXT DEFAULT 'moderator',
      added_by TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      reason TEXT,
      mod_user_id TEXT,
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (channel_id) REFERENCES channels(channel_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bans (
      id INTEGER PRIMARY KEY,
      user_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      reason TEXT,
      banned_by TEXT,
      banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      active BOOLEAN DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mutes (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      reason TEXT,
      muted_by TEXT,
      muted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      active BOOLEAN DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (channel_id) REFERENCES channels(channel_id)
    )
  `);

  // Achievements master list
  db.exec(`
    CREATE TABLE IF NOT EXISTS achievements (
      key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      xp INTEGER DEFAULT 0,
      icon TEXT
    )
  `);

  // User earned achievements
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      achievement_key TEXT NOT NULL,
      earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (achievement_key) REFERENCES achievements(key),
      UNIQUE(user_id, achievement_key)
    )
  `);


  // Custom commands — admin/user created slash commands
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_commands (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      response TEXT NOT NULL,
      created_by TEXT NOT NULL,
      use_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);


  // Calendar events
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      event_time DATETIME NOT NULL,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Per-event notification schedule
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_notifications (
      id INTEGER PRIMARY KEY,
      event_id INTEGER NOT NULL,
      notify_at DATETIME NOT NULL,
      offset_label TEXT NOT NULL,
      sent BOOLEAN DEFAULT 0,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    )
  `);

  // RSVP records
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_rsvps (
      id INTEGER PRIMARY KEY,
      event_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      rsvp_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      UNIQUE(event_id, user_id)
    )
  `);


  // RSS feeds
  db.exec(`
    CREATE TABLE IF NOT EXISTS rss_feeds (
      id INTEGER PRIMARY KEY,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      filter TEXT,
      active BOOLEAN DEFAULT 1,
      added_by TEXT NOT NULL,
      channel_id TEXT,
      last_checked DATETIME,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seen RSS items — prevents reposting
  db.exec(`
    CREATE TABLE IF NOT EXISTS rss_seen (
      id INTEGER PRIMARY KEY,
      feed_id INTEGER NOT NULL,
      item_guid TEXT NOT NULL,
      seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (feed_id) REFERENCES rss_feeds(id) ON DELETE CASCADE,
      UNIQUE(feed_id, item_guid)
    )
  `);

    // Migrations: safely add columns to existing databases
  const migrations = [
    'ALTER TABLE users ADD COLUMN last_daily_claim DATETIME',
    'ALTER TABLE rss_feeds ADD COLUMN channel_id TEXT',
    'ALTER TABLE users ADD COLUMN daily_streak INTEGER DEFAULT 0',
    'ALTER TABLE mod_logs ADD COLUMN duration_minutes INTEGER',
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!err.message.includes('duplicate column')) throw err;
    }
  }


  // Seed achievement definitions (insert or ignore if already present)
  const { ACHIEVEMENTS } = require('./achievements');
  const insertAchievement = db.prepare(
    'INSERT OR IGNORE INTO achievements (key, category, name, description, xp, icon) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const seedAll = db.transaction(() => {
    for (const a of ACHIEVEMENTS) {
      insertAchievement.run(a.key, a.category, a.name, a.description, a.xp, a.icon);
    }
  });
  seedAll();

  console.log('✅ Database initialized');
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------
const users = {
  getOrCreate(userId, username) {
    const stmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
    let user = stmt.get(userId);
    if (!user) {
      db.prepare('INSERT INTO users (user_id, username) VALUES (?, ?)').run(userId, username);
      user = stmt.get(userId);
    }
    return user;
  },

  get(userId) {
    return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  },

  // Case-insensitive username lookup — used by moderation to resolve @mentions
  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username) || null;
  },

  addXP(userId, username, amount = 10) {
    this.getOrCreate(userId, username);
    db.prepare('UPDATE users SET xp = xp + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(amount, userId);

    const user = this.get(userId);
    const newLevel = Math.floor(user.xp / 100) + 1;
    if (newLevel !== user.level) {
      db.prepare('UPDATE users SET level = ? WHERE user_id = ?').run(newLevel, userId);
      return { leveledUp: true, newLevel };
    }
    return { leveledUp: false };
  },

  getLeaderboard(limit = 10) {
    return db.prepare('SELECT user_id, username, xp, level FROM users ORDER BY xp DESC LIMIT ?').all(limit);
  },

  getProfile(userId) {
    return db.prepare(
      'SELECT user_id, username, xp, level, last_daily_claim, daily_streak, created_at FROM users WHERE user_id = ?'
    ).get(userId);
  },

  // Returns { claimed: true, result } or { claimed: false }
  claimDaily(userId, username, amount = 100) {
    const user = this.getOrCreate(userId, username);
    if (user.last_daily_claim) {
      const lastClaim = new Date(user.last_daily_claim);
      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);
      if (lastClaim >= todayMidnight) return { claimed: false };

      // Streak: if last claim was yesterday, increment; otherwise reset to 1
      const yesterdayMidnight = new Date(todayMidnight);
      yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);
      const previousStreak = user.daily_streak || 0;
      const newStreak = lastClaim >= yesterdayMidnight ? previousStreak + 1 : 1;
      db.prepare('UPDATE users SET last_daily_claim = CURRENT_TIMESTAMP, daily_streak = ? WHERE user_id = ?').run(newStreak, userId);
      const result = this.addXP(userId, username, amount);
      const updatedUser = this.get(userId);
      return { claimed: true, result, streak: updatedUser.daily_streak || 1, previousStreak };
    } else {
      // First ever claim
      db.prepare('UPDATE users SET last_daily_claim = CURRENT_TIMESTAMP, daily_streak = 1 WHERE user_id = ?').run(userId);
      const result = this.addXP(userId, username, amount);
      return { claimed: true, result, streak: 1, previousStreak: 0 };
    }
  },
};

// ---------------------------------------------------------------------------
// Channel operations
// ---------------------------------------------------------------------------
const channels = {
  getOrCreate(channelId, channelName = 'Unknown', serverUrl = '') {
    const stmt = db.prepare('SELECT * FROM channels WHERE channel_id = ?');
    let channel = stmt.get(channelId);
    if (!channel) {
      db.prepare('INSERT INTO channels (channel_id, channel_name, server_url) VALUES (?, ?, ?)').run(channelId, channelName, serverUrl);
      channel = stmt.get(channelId);
    }
    return channel;
  },

  get(channelId) {
    const channel = db.prepare('SELECT * FROM channels WHERE channel_id = ?').get(channelId);
    if (channel && channel.settings) channel.settings = JSON.parse(channel.settings);
    return channel;
  },

  updateSettings(channelId, settings) {
    db.prepare('UPDATE channels SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?').run(JSON.stringify(settings), channelId);
  },

  getSettings(channelId) {
    const channel = this.get(channelId);
    return channel ? channel.settings : {};
  },
};

// ---------------------------------------------------------------------------
// User stats operations
// ---------------------------------------------------------------------------
const stats = {
  getOrCreate(userId, channelId) {
    const stmt = db.prepare('SELECT * FROM user_stats WHERE user_id = ? AND channel_id = ?');
    let stat = stmt.get(userId, channelId);
    if (!stat) {
      db.prepare('INSERT INTO user_stats (user_id, channel_id) VALUES (?, ?)').run(userId, channelId);
      stat = stmt.get(userId, channelId);
    }
    return stat;
  },

  // XP is global — awarded to users table. user_stats tracks message counts only.
  addMessage(userId, channelId, xpAmount = 5) {
    this.getOrCreate(userId, channelId);

    // Increment per-channel message count (secondary stat)
    db.prepare(
      'UPDATE user_stats SET messages = messages + 1, last_xp_time = CURRENT_TIMESTAMP WHERE user_id = ? AND channel_id = ?'
    ).run(userId, channelId);

    // Award XP globally
    db.prepare(
      'UPDATE users SET xp = xp + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?'
    ).run(xpAmount, userId);

    // Recalculate global level
    const user = db.prepare('SELECT xp, level FROM users WHERE user_id = ?').get(userId);
    const newLevel = Math.floor(user.xp / 100) + 1;
    if (newLevel !== user.level) {
      db.prepare('UPDATE users SET level = ? WHERE user_id = ?').run(newLevel, userId);
      return { leveledUp: true, newLevel };
    }
    return { leveledUp: false };
  },

  // Global leaderboard — XP is now server-wide
  getChannelLeaderboard(channelId, limit = 10) {
    return db.prepare(`
      SELECT user_id, username, xp, level
      FROM users
      ORDER BY xp DESC
      LIMIT ?
    `).all(limit);
  },

  // Global rank by XP
  getChannelRank(userId, channelId) {
    const rank = db.prepare(`
      SELECT COUNT(*) + 1 as rank FROM users
      WHERE xp > (SELECT COALESCE(xp, 0) FROM users WHERE user_id = ?)
    `).get(userId);
    const total = db.prepare('SELECT COUNT(*) as count FROM users').get();
    return { rank: rank ? rank.rank : 1, total: total.count };
  },

  getUserStats(userId, channelId) {
    return db.prepare('SELECT * FROM user_stats WHERE user_id = ? AND channel_id = ?').get(userId, channelId);
  },

  // Get message counts across all channels for a user
  getChannelBreakdown(userId) {
    return db.prepare(`
      SELECT us.channel_id, us.messages,
             COALESCE(c.channel_name, us.channel_id) as channel_name
      FROM user_stats us
      LEFT JOIN channels c ON us.channel_id = c.channel_id
      WHERE us.user_id = ? AND us.messages > 0
      ORDER BY us.messages DESC
    `).all(userId);
  },
};

// ---------------------------------------------------------------------------
// Moderation log operations
// ---------------------------------------------------------------------------
const modLogs = {
  // FIX #9: accepts optional durationMinutes
  log(channelId, action, targetUserId, modUserId, reason = '', durationMinutes = null) {
    return db.prepare(
      'INSERT INTO mod_logs (channel_id, action, target_user_id, mod_user_id, reason, duration_minutes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(channelId, action, targetUserId, modUserId, reason, durationMinutes);
  },

  getLogs(channelId, limit = 50) {
    return db.prepare('SELECT * FROM mod_logs WHERE channel_id = ? ORDER BY timestamp DESC LIMIT ?').all(channelId, limit);
  },
};

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------
const admins = {
  add(userId, username, role = 'moderator', addedBy = 'system') {
    try {
      return db.prepare('INSERT INTO admin_users (user_id, username, role, added_by) VALUES (?, ?, ?, ?)').run(userId, username, role, addedBy);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) return false;
      console.error('admins.add error:', err.message);
      throw err;
    }
  },

  remove(userId) {
    return db.prepare('DELETE FROM admin_users WHERE user_id = ?').run(userId);
  },

  isAdmin(userId) {
    return db.prepare('SELECT id FROM admin_users WHERE user_id = ?').get(userId) !== undefined;
  },

  getAll() {
    return db.prepare('SELECT * FROM admin_users ORDER BY added_at DESC').all();
  },
};

// ---------------------------------------------------------------------------
// Ban operations
// FIX #3: ensureUserExists() called before any FK-constrained insert
// ---------------------------------------------------------------------------
function ensureUserExists(userId, username) {
  const existing = db.prepare('SELECT id FROM users WHERE user_id = ?').get(userId);
  if (!existing) {
    db.prepare('INSERT INTO users (user_id, username) VALUES (?, ?)').run(userId, username || userId);
  }
}

const bans = {
  add(userId, username, reason = '', bannedBy = 'system', expiresAt = null) {
    try {
      ensureUserExists(userId, username);
      return db.prepare(
        'INSERT INTO bans (user_id, username, reason, banned_by, expires_at, active) VALUES (?, ?, ?, ?, ?, 1)'
      ).run(userId, username, reason, bannedBy, expiresAt);
    } catch (err) {
      console.error('bans.add error:', err.message);
      return false;
    }
  },

  remove(userId) {
    return db.prepare('UPDATE bans SET active = 0 WHERE user_id = ?').run(userId);
  },

  isBanned(userId) {
    return db.prepare('SELECT id FROM bans WHERE user_id = ? AND active = 1').get(userId) !== undefined;
  },

  getBan(userId) {
    return db.prepare('SELECT * FROM bans WHERE user_id = ? AND active = 1').get(userId);
  },

  getAll() {
    return db.prepare('SELECT * FROM bans WHERE active = 1 ORDER BY banned_at DESC').all();
  },
};

// ---------------------------------------------------------------------------
// Warning operations
// FIX #3: ensureUserExists() called before insert
// ---------------------------------------------------------------------------
const warnings = {
  add(userId, channelId, reason = '', modUserId = 'system', username = null) {
    ensureUserExists(userId, username);
    return db.prepare(
      'INSERT INTO warnings (user_id, channel_id, reason, mod_user_id) VALUES (?, ?, ?, ?)'
    ).run(userId, channelId, reason, modUserId);
  },

  getCount(userId, channelId) {
    return db.prepare('SELECT COUNT(*) as count FROM warnings WHERE user_id = ? AND channel_id = ?').get(userId, channelId).count;
  },

  getWarnings(userId, channelId) {
    return db.prepare('SELECT * FROM warnings WHERE user_id = ? AND channel_id = ? ORDER BY issued_at DESC').all(userId, channelId);
  },

  clearWarnings(userId, channelId) {
    return db.prepare('DELETE FROM warnings WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
  },
};

// ---------------------------------------------------------------------------
// Mute operations
// FIX #3: ensureUserExists() called before insert
// FIX #8: expireOld() marks stale active mutes as inactive
// ---------------------------------------------------------------------------
const mutes = {
  add(userId, channelId, reason = '', mutedBy = 'system', durationMinutes = 60, username = null) {
    try {
      ensureUserExists(userId, username);
      const expiresAt = new Date(Date.now() + durationMinutes * 60000).toISOString();
      return db.prepare(
        'INSERT INTO mutes (user_id, channel_id, reason, muted_by, expires_at, active) VALUES (?, ?, ?, ?, ?, 1)'
      ).run(userId, channelId, reason, mutedBy, expiresAt);
    } catch (err) {
      console.error('mutes.add error:', err.message);
      return false;
    }
  },

  remove(userId, channelId) {
    return db.prepare('UPDATE mutes SET active = 0 WHERE user_id = ? AND channel_id = ?').run(userId, channelId);
  },

  isActive(userId, channelId) {
    this.expireOld();
    return db.prepare(
      'SELECT id FROM mutes WHERE user_id = ? AND channel_id = ? AND active = 1 AND expires_at > CURRENT_TIMESTAMP'
    ).get(userId, channelId) !== undefined;
  },

  getMute(userId, channelId) {
    this.expireOld();
    return db.prepare(
      'SELECT * FROM mutes WHERE user_id = ? AND channel_id = ? AND active = 1 AND expires_at > CURRENT_TIMESTAMP'
    ).get(userId, channelId);
  },

  // FIX #8: flip active=0 on any mute whose time has passed
  expireOld() {
    db.prepare("UPDATE mutes SET active = 0 WHERE active = 1 AND expires_at <= CURRENT_TIMESTAMP").run();
  },
};


// ---------------------------------------------------------------------------
// Custom command operations
// ---------------------------------------------------------------------------
const customCommands = {
  create(name, response, createdBy) {
    try {
      return db.prepare(
        'INSERT INTO custom_commands (name, response, created_by) VALUES (LOWER(?), ?, ?)'
      ).run(name, response, createdBy);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) return null; // already exists
      throw err;
    }
  },

  update(name, response) {
    return db.prepare(
      'UPDATE custom_commands SET response = ?, updated_at = CURRENT_TIMESTAMP WHERE name = LOWER(?)'
    ).run(response, name);
  },

  remove(name) {
    return db.prepare('DELETE FROM custom_commands WHERE name = LOWER(?)').run(name);
  },

  get(name) {
    return db.prepare('SELECT * FROM custom_commands WHERE name = LOWER(?)').get(name);
  },

  getAll() {
    return db.prepare('SELECT * FROM custom_commands ORDER BY name ASC').all();
  },

  incrementUseCount(name) {
    db.prepare('UPDATE custom_commands SET use_count = use_count + 1 WHERE name = LOWER(?)').run(name);
  },

  exists(name) {
    return db.prepare('SELECT id FROM custom_commands WHERE name = LOWER(?)').get(name) !== undefined;
  },
};


// ---------------------------------------------------------------------------
// Calendar operations
// ---------------------------------------------------------------------------
const calendar = {
  // Create event, returns the new event id
  createEvent(title, eventTimeUtc, channelId, createdBy) {
    const result = db.prepare(
      'INSERT INTO events (title, event_time, channel_id, created_by) VALUES (?, ?, ?, ?)'
    ).run(title, eventTimeUtc, channelId, createdBy);
    return result.lastInsertRowid;
  },

  getEvent(eventId) {
    return db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  },

  getUpcoming(limit = 10) {
    return db.prepare(
      'SELECT * FROM events WHERE event_time > CURRENT_TIMESTAMP ORDER BY event_time ASC LIMIT ?'
    ).all(limit);
  },

  getUpcomingForChannel(channelId, limit = 10) {
    return db.prepare(
      'SELECT * FROM events WHERE channel_id = ? AND event_time > CURRENT_TIMESTAMP ORDER BY event_time ASC LIMIT ?'
    ).all(channelId, limit);
  },

  updateEvent(eventId, fields) {
    const allowed = ['title', 'event_time'];
    const sets = Object.keys(fields)
      .filter(k => allowed.includes(k))
      .map(k => `${k} = ?`).join(', ');
    const values = Object.keys(fields)
      .filter(k => allowed.includes(k))
      .map(k => fields[k]);
    if (!sets) return false;
    db.prepare(`UPDATE events SET ${sets} WHERE id = ?`).run(...values, eventId);
    return true;
  },

  deleteEvent(eventId) {
    db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
  },

  // Notifications
  addNotification(eventId, notifyAtUtc, offsetLabel) {
    return db.prepare(
      'INSERT INTO event_notifications (event_id, notify_at, offset_label) VALUES (?, ?, ?)'
    ).run(eventId, notifyAtUtc, offsetLabel);
  },

  clearNotifications(eventId) {
    db.prepare('DELETE FROM event_notifications WHERE event_id = ?').run(eventId);
  },

  getPendingNotifications() {
    return db.prepare(`
      SELECT en.*, e.title, e.event_time, e.channel_id
      FROM event_notifications en
      JOIN events e ON en.event_id = e.id
      WHERE en.sent = 0 AND en.notify_at <= CURRENT_TIMESTAMP
      ORDER BY en.notify_at ASC
    `).all();
  },

  markNotificationSent(notificationId) {
    db.prepare('UPDATE event_notifications SET sent = 1 WHERE id = ?').run(notificationId);
  },

  // RSVPs
  toggleRsvp(eventId, userId, username) {
    const existing = db.prepare(
      'SELECT id FROM event_rsvps WHERE event_id = ? AND user_id = ?'
    ).get(eventId, userId);

    if (existing) {
      db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(eventId, userId);
      return { attending: false };
    } else {
      db.prepare(
        'INSERT INTO event_rsvps (event_id, user_id, username) VALUES (?, ?, ?)'
      ).run(eventId, userId, username);
      return { attending: true };
    }
  },

  getRsvps(eventId) {
    return db.prepare(
      'SELECT * FROM event_rsvps WHERE event_id = ? ORDER BY rsvp_at ASC'
    ).all(eventId);
  },
};


// ---------------------------------------------------------------------------
// RSS feed operations
// ---------------------------------------------------------------------------
const rssFeeds = {
  add(url, addedBy, filter = null, channelId = null) {
    try {
      return db.prepare(
        'INSERT INTO rss_feeds (url, added_by, filter, channel_id) VALUES (?, ?, ?, ?)'
      ).run(url, addedBy, filter, channelId);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) return null;
      throw err;
    }
  },

  get(feedId) {
    return db.prepare('SELECT * FROM rss_feeds WHERE id = ?').get(feedId);
  },

  getAll() {
    return db.prepare('SELECT * FROM rss_feeds ORDER BY added_at ASC').all();
  },

  getActive() {
    return db.prepare('SELECT * FROM rss_feeds WHERE active = 1').all();
  },

  setActive(feedId, active) {
    return db.prepare('UPDATE rss_feeds SET active = ? WHERE id = ?').run(active ? 1 : 0, feedId);
  },

  updateTitle(feedId, title) {
    return db.prepare('UPDATE rss_feeds SET title = ? WHERE id = ?').run(title, feedId);
  },

  updateLastChecked(feedId) {
    return db.prepare('UPDATE rss_feeds SET last_checked = CURRENT_TIMESTAMP WHERE id = ?').run(feedId);
  },

  remove(feedId) {
    return db.prepare('DELETE FROM rss_feeds WHERE id = ?').run(feedId);
  },

  // Returns true if this guid has been seen before for this feed
  isSeen(feedId, guid) {
    return db.prepare(
      'SELECT id FROM rss_seen WHERE feed_id = ? AND item_guid = ?'
    ).get(feedId, guid) !== undefined;
  },

  markSeen(feedId, guid) {
    try {
      db.prepare('INSERT INTO rss_seen (feed_id, item_guid) VALUES (?, ?)').run(feedId, guid);
    } catch {
      // already seen, ignore
    }
  },

  // Mark all current items as seen (used on feed add to avoid flooding)
  markAllSeen(feedId, guids) {
    const insert = db.prepare('INSERT OR IGNORE INTO rss_seen (feed_id, item_guid) VALUES (?, ?)');
    const insertAll = db.transaction((gs) => {
      for (const g of gs) insert.run(feedId, g);
    });
    insertAll(guids);
  },
};

module.exports = {
  db,
  initializeDatabase,
  users,
  channels,
  stats,
  modLogs,
  admins,
  bans,
  warnings,
  mutes,
  customCommands,
  calendar,
  rssFeeds,
};
