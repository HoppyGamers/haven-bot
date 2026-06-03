// ---------------------------------------------------------------------------
// src/rpg/database.js
//
// RPG system database — separate from haven-bot.db and haven-agent.db
// Stores campaigns, characters, sessions, game state, and combat encounters.
// ---------------------------------------------------------------------------

const Database = require('better-sqlite3');
const path     = require('path');

let db = null;

function initRpgDatabase() {
  const dbPath = process.env.RPG_DB_PATH ||
    (process.env.DB_PATH
      ? path.join(path.dirname(process.env.DB_PATH), 'haven-rpg.db')
      : path.join(process.cwd(), 'haven-rpg.db'));

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── Campaigns ──────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id  TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      system      TEXT NOT NULL DEFAULT 'dnd5e',
      status      TEXT NOT NULL DEFAULT 'active',
      dm_user_id  TEXT,
      dm_username TEXT,
      scene       TEXT,
      arc         TEXT,
      current_act INTEGER DEFAULT 1,
      current_beat TEXT,
      turn_timeout_minutes INTEGER DEFAULT 60,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Characters ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id  INTEGER NOT NULL,
      user_id      TEXT NOT NULL,
      username     TEXT NOT NULL,
      name         TEXT NOT NULL,
      class        TEXT NOT NULL DEFAULT 'Fighter',
      race         TEXT NOT NULL DEFAULT 'Human',
      level        INTEGER DEFAULT 1,
      hp_max       INTEGER DEFAULT 10,
      hp_current   INTEGER DEFAULT 10,
      ac           INTEGER DEFAULT 10,
      str INTEGER DEFAULT 10, dex INTEGER DEFAULT 10,
      con INTEGER DEFAULT 10, int INTEGER DEFAULT 10,
      wis INTEGER DEFAULT 10, cha INTEGER DEFAULT 10,
      inventory    TEXT DEFAULT '[]',
      conditions   TEXT DEFAULT '[]',
      notes        TEXT DEFAULT '',
      active       BOOLEAN DEFAULT 1,
      joined_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
      UNIQUE(campaign_id, user_id)
    )
  `);

  // ── Sessions ───────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      summary     TEXT,
      started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at    DATETIME,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);

  // ── Game log — all in-game messages and DM narrations ─────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      session_id  INTEGER,
      type        TEXT NOT NULL,
      username    TEXT,
      content     TEXT NOT NULL,
      dice_rolls  TEXT,
      timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);

  // ── Combat encounters ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS combat (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL UNIQUE,
      active      BOOLEAN DEFAULT 1,
      round       INTEGER DEFAULT 1,
      initiative  TEXT DEFAULT '[]',
      enemies     TEXT DEFAULT '[]',
      started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);

  console.log(`🎲 RPG database: ${dbPath}`);
  return db;
}

function getDb() { return db; }

// ---------------------------------------------------------------------------
// Campaign operations
// ---------------------------------------------------------------------------
const campaigns = {
  create(channelId, name, system, dmUserId, dmUsername) {
    return db.prepare(`
      INSERT INTO campaigns (channel_id, name, system, dm_user_id, dm_username)
      VALUES (?, ?, ?, ?, ?)
    `).run(channelId, name, system, dmUserId, dmUsername);
  },

  getByChannel(channelId) {
    return db.prepare('SELECT * FROM campaigns WHERE channel_id = ?').get(channelId);
  },

  updateScene(campaignId, scene) {
    return db.prepare('UPDATE campaigns SET scene = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(scene, campaignId);
  },

  updateArc(campaignId, arc, currentAct, currentBeat) {
    return db.prepare('UPDATE campaigns SET arc = ?, current_act = ?, current_beat = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(arc, currentAct, currentBeat, campaignId);
  },

  advanceAct(campaignId, act, beat) {
    return db.prepare('UPDATE campaigns SET current_act = ?, current_beat = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(act, beat, campaignId);
  },

  setStatus(campaignId, status) {
    return db.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, campaignId);
  },

  getAll() {
    return db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  },
};

// ---------------------------------------------------------------------------
// Character operations
// ---------------------------------------------------------------------------
const characters = {
  create(campaignId, userId, username, name, charClass, race, stats) {
    const hp = 8 + Math.floor((stats.con - 10) / 2);
    return db.prepare(`
      INSERT INTO characters
        (campaign_id, user_id, username, name, class, race,
         hp_max, hp_current, str, dex, con, int, wis, cha)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(campaignId, userId, username, name, charClass, race,
        hp, hp, stats.str, stats.dex, stats.con, stats.int, stats.wis, stats.cha);
  },

  getByCampaignAndUser(campaignId, userId) {
    return db.prepare('SELECT * FROM characters WHERE campaign_id = ? AND user_id = ? AND active = 1').get(campaignId, userId);
  },

  getParty(campaignId) {
    return db.prepare('SELECT * FROM characters WHERE campaign_id = ? AND active = 1').all(campaignId);
  },

  updateHp(charId, hp) {
    return db.prepare('UPDATE characters SET hp_current = ? WHERE id = ?').run(hp, charId);
  },

  addCondition(charId, condition) {
    const char = db.prepare('SELECT conditions FROM characters WHERE id = ?').get(charId);
    const conds = JSON.parse(char.conditions || '[]');
    if (!conds.includes(condition)) {
      conds.push(condition);
      db.prepare('UPDATE characters SET conditions = ? WHERE id = ?').run(JSON.stringify(conds), charId);
    }
  },

  removeCondition(charId, condition) {
    const char = db.prepare('SELECT conditions FROM characters WHERE id = ?').get(charId);
    const conds = JSON.parse(char.conditions || '[]').filter(c => c !== condition);
    db.prepare('UPDATE characters SET conditions = ? WHERE id = ?').run(JSON.stringify(conds), charId);
  },

  addItem(charId, item) {
    const char = db.prepare('SELECT inventory FROM characters WHERE id = ?').get(charId);
    const inv = JSON.parse(char.inventory || '[]');
    inv.push(item);
    db.prepare('UPDATE characters SET inventory = ? WHERE id = ?').run(JSON.stringify(inv), charId);
  },

  updateNotes(charId, notes) {
    return db.prepare('UPDATE characters SET notes = ? WHERE id = ?').run(notes, charId);
  },
};

// ---------------------------------------------------------------------------
// Game log operations
// ---------------------------------------------------------------------------
const gameLog = {
  add(campaignId, type, content, username = null, diceRolls = null, sessionId = null) {
    return db.prepare(`
      INSERT INTO game_log (campaign_id, session_id, type, username, content, dice_rolls)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(campaignId, sessionId, type, username, content, diceRolls ? JSON.stringify(diceRolls) : null);
  },

  getRecent(campaignId, limit = 20) {
    return db.prepare(`
      SELECT * FROM game_log WHERE campaign_id = ?
      ORDER BY timestamp DESC LIMIT ?
    `).all(campaignId, limit).reverse();
  },

  getSession(campaignId, sessionId) {
    return db.prepare('SELECT * FROM game_log WHERE campaign_id = ? AND session_id = ? ORDER BY timestamp').all(campaignId, sessionId);
  },
};

// ---------------------------------------------------------------------------
// Combat operations
// ---------------------------------------------------------------------------
const combat = {
  start(campaignId, initiative, enemies) {
    const existing = db.prepare('SELECT id FROM combat WHERE campaign_id = ?').get(campaignId);
    if (existing) {
      db.prepare('UPDATE combat SET active = 1, round = 1, initiative = ?, enemies = ?, started_at = CURRENT_TIMESTAMP WHERE campaign_id = ?')
        .run(JSON.stringify(initiative), JSON.stringify(enemies), campaignId);
    } else {
      db.prepare('INSERT INTO combat (campaign_id, initiative, enemies) VALUES (?, ?, ?)')
        .run(campaignId, JSON.stringify(initiative), JSON.stringify(enemies));
    }
  },

  get(campaignId) {
    const c = db.prepare('SELECT * FROM combat WHERE campaign_id = ? AND active = 1').get(campaignId);
    if (!c) return null;
    return {
      ...c,
      initiative: JSON.parse(c.initiative || '[]'),
      enemies:    JSON.parse(c.enemies    || '[]'),
    };
  },

  update(campaignId, data) {
    db.prepare('UPDATE combat SET round = ?, initiative = ?, enemies = ? WHERE campaign_id = ?')
      .run(data.round, JSON.stringify(data.initiative), JSON.stringify(data.enemies), campaignId);
  },

  end(campaignId) {
    db.prepare('UPDATE combat SET active = 0 WHERE campaign_id = ?').run(campaignId);
  },
};

// ---------------------------------------------------------------------------
// Session operations
// ---------------------------------------------------------------------------
const sessions = {
  start(campaignId) {
    const result = db.prepare('INSERT INTO sessions (campaign_id) VALUES (?)').run(campaignId);
    return result.lastInsertRowid;
  },

  end(sessionId, summary) {
    db.prepare('UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, summary = ? WHERE id = ?').run(summary, sessionId);
  },

  getLast(campaignId) {
    return db.prepare('SELECT * FROM sessions WHERE campaign_id = ? ORDER BY started_at DESC LIMIT 1').get(campaignId);
  },
};

module.exports = { initRpgDatabase, getDb, campaigns, characters, gameLog, combat, sessions };
