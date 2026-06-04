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

  // ── Image triggers ───────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rpg_image_triggers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern     TEXT NOT NULL,
      style       TEXT NOT NULL DEFAULT 'scene',
      system      TEXT NOT NULL DEFAULT 'all',
      description TEXT,
      enabled     BOOLEAN DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Pre-populate default triggers if table is empty
  const triggerCount = db.prepare('SELECT COUNT(*) as c FROM rpg_image_triggers').get();
  if (triggerCount.c === 0) {
    const defaults = [
      // Scene transitions
      { pattern: 'you enter|you step into|you arrive|you find yourself', style: 'scene', system: 'all', description: 'Entering a new location' },
      { pattern: 'before you (stands?|lies?|looms?)|stretches? (before|ahead)', style: 'scene', system: 'all', description: 'Scene reveal' },
      { pattern: 'you (reach|approach|emerge)', style: 'scene', system: 'all', description: 'Arriving somewhere' },
      { pattern: 'comes? into view|opens? up (before|ahead)', style: 'scene', system: 'all', description: 'Location revealed' },
      // Environmental
      { pattern: '(narrow|ancient|crumbling|shadowy|dark|dense|misty|vast)\s+(bridge|stream|path|corridor|room|chamber|clearing|village|tower|gate|cave|ruins)', style: 'scene', system: 'all', description: 'Significant environment detail' },
      { pattern: '(tavern|inn|castle|dungeon|forest|temple|cave|ruins|market|harbor)', style: 'scene', system: 'dnd5e', description: 'D&D location types' },
      { pattern: '(cantina|starport|hangar|bridge|cockpit|planet surface|space station)', style: 'scene', system: 'starwars', description: 'Star Wars locations' },
      { pattern: '(neon|alley|corporate tower|nightclub|slums|rooftop|server room)', style: 'scene', system: 'cyberpunk', description: 'Cyberpunk locations' },
      { pattern: '(space station|ship corridor|colony|asteroid|alien world)', style: 'scene', system: 'scifi', description: 'Sci-Fi locations' },
      { pattern: '(mansion|asylum|graveyard|basement|attic|ritual chamber)', style: 'scene', system: 'horror', description: 'Horror locations' },
      // Monster/enemy
      { pattern: 'emerges?|bursts? (from|through)|lunges?|charges?|snarls?|roars?', style: 'monster', system: 'all', description: 'Enemy appears aggressively' },
      { pattern: 'reveals? (itself|themselves)|steps? (out|forward) (from|into)', style: 'monster', system: 'all', description: 'Enemy reveals itself' },
      { pattern: '(goblin|orc|dragon|troll|undead|skeleton|wolf|spider|demon) (attacks?|appears?|emerges?)', style: 'monster', system: 'dnd5e', description: 'D&D monster encounter' },
      { pattern: '(stormtrooper|sith|bounty hunter|droid|wampa|rancor)', style: 'monster', system: 'starwars', description: 'Star Wars enemy' },
      { pattern: '(gang member|corpo agent|cyborg|netrunner|MaxTac)', style: 'monster', system: 'cyberpunk', description: 'Cyberpunk enemy' },
      // Combat
      { pattern: 'initiative|combat begins|battle starts|roll for attack', style: 'scene', system: 'all', description: 'Combat starts' },
      // NPC introduction
      { pattern: 'introduces? (herself|himself|themselves)|you (notice|spot|see) (a|an) (figure|person|woman|man)', style: 'scene', system: 'all', description: 'NPC appears' },
    ];
    const stmt = db.prepare('INSERT INTO rpg_image_triggers (pattern, style, system, description) VALUES (?, ?, ?, ?)');
    for (const t of defaults) {
      stmt.run(t.pattern, t.style, t.system, t.description);
    }
    console.log(`🎲 RPG image triggers: ${defaults.length} defaults loaded`);
  }

  // ── RPG Art Styles ───────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rpg_art_styles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT UNIQUE NOT NULL,
      label       TEXT NOT NULL,
      prefix      TEXT NOT NULL,
      negative    TEXT NOT NULL DEFAULT '',
      enabled     BOOLEAN DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const styleCount = db.prepare('SELECT COUNT(*) as c FROM rpg_art_styles').get();
  if (styleCount.c === 0) {
    const defaults = [
      { key: 'anime',      label: 'Anime',               prefix: 'anime style, Studio Ghibli, cel shaded, 2D animation,',          negative: 'realistic, photorealistic, 3d render' },
      { key: 'comic',      label: 'Comic Book',           prefix: 'comic book art, bold ink outlines, Marvel style, flat cel shading,', negative: 'photorealistic, blurry outlines' },
      { key: 'cartoon',    label: 'Cartoon / Pixar',      prefix: 'cartoon style, Pixar 3D animation, vibrant colors, stylized,',    negative: 'realistic, dark, gritty' },
      { key: 'oil',        label: 'Oil Painting',         prefix: 'oil painting, classical art, Renaissance style, detailed brushwork,', negative: 'digital art, anime' },
      { key: 'grimdark',   label: 'Dark Fantasy',         prefix: 'dark fantasy art, grimdark, gothic horror, desaturated,',         negative: 'bright colors, cheerful' },
      { key: 'watercolor', label: 'Watercolor',           prefix: 'watercolor illustration, soft washes, painterly, wet media,',     negative: 'digital art, sharp edges' },
      { key: 'pixel',      label: 'Pixel Art (16-bit)',   prefix: 'pixel art, 16-bit SNES RPG style, retro game sprite,',            negative: 'realistic, photorealistic, blurry' },
    ];
    const stmt = db.prepare('INSERT INTO rpg_art_styles (key, label, prefix, negative) VALUES (?, ?, ?, ?)');
    for (const s of defaults) stmt.run(s.key, s.label, s.prefix, s.negative);
    console.log('🎲 RPG art styles: defaults loaded');
  }

  // ── RPG Settings ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rpg_settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      description TEXT,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Pre-populate defaults if empty
  const settingCount = db.prepare('SELECT COUNT(*) as c FROM rpg_settings').get();
  if (settingCount.c === 0) {
    const defaults = [
      { key: 'image_width',    value: '832',  description: 'Generated image width in pixels' },
      { key: 'image_height',   value: '512',  description: 'Generated image height in pixels' },
      { key: 'image_steps',    value: '4',    description: 'Diffusion steps (fewer = faster, less detail)' },
      { key: 'image_cfg',      value: '2.0',  description: 'Guidance scale (higher = more prompt adherence)' },
      { key: 'image_cooldown', value: '45',   description: 'Seconds between scene images per channel' },
      { key: 'image_enabled',  value: 'true', description: 'Enable/disable image generation globally' },
      { key: 'image_art_style', value: '',     description: 'Art style suffix added to all prompts (e.g. anime style, comic book art, oil painting)' },
    ];
    const stmt = db.prepare('INSERT INTO rpg_settings (key, value, description) VALUES (?, ?, ?)');
    for (const s of defaults) stmt.run(s.key, s.value, s.description);
    console.log('🎲 RPG settings: defaults loaded');
  }

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
// Art Style operations
// ---------------------------------------------------------------------------
const artStyles = {
  getAll() {
    return db.prepare('SELECT * FROM rpg_art_styles ORDER BY id').all();
  },
  getEnabled() {
    return db.prepare('SELECT * FROM rpg_art_styles WHERE enabled = 1 ORDER BY id').all();
  },
  add(key, label, prefix, negative) {
    return db.prepare('INSERT INTO rpg_art_styles (key, label, prefix, negative) VALUES (?, ?, ?, ?)').run(key, label, prefix, negative);
  },
  update(id, key, label, prefix, negative, enabled) {
    return db.prepare('UPDATE rpg_art_styles SET key=?, label=?, prefix=?, negative=?, enabled=? WHERE id=?').run(key, label, prefix, negative, enabled ? 1 : 0, id);
  },
  delete(id) {
    return db.prepare('DELETE FROM rpg_art_styles WHERE id=?').run(id);
  },
};

// ---------------------------------------------------------------------------
// RPG Settings operations
// ---------------------------------------------------------------------------
const rpgSettings = {
  getAll() {
    return db.prepare('SELECT * FROM rpg_settings ORDER BY key').all();
  },
  get(key) {
    const row = db.prepare('SELECT value FROM rpg_settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  getInt(key, fallback = 0) {
    const val = this.get(key);
    return val !== null ? parseInt(val) : fallback;
  },
  getFloat(key, fallback = 0) {
    const val = this.get(key);
    return val !== null ? parseFloat(val) : fallback;
  },
  getBool(key, fallback = true) {
    const val = this.get(key);
    return val !== null ? val === 'true' : fallback;
  },
  set(key, value) {
    return db.prepare(
      'INSERT OR REPLACE INTO rpg_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run(key, String(value));
  },
  setMany(updates) {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO rpg_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    );
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, String(value));
    }
  },
};

// ---------------------------------------------------------------------------
// Image trigger operations
// ---------------------------------------------------------------------------
const imageTriggers = {
  getAll() {
    return db.prepare('SELECT * FROM rpg_image_triggers ORDER BY system, style, id').all();
  },
  getEnabled(system) {
    return db.prepare(
      'SELECT * FROM rpg_image_triggers WHERE enabled = 1 AND (system = ? OR system = ?)'
    ).all(system, 'all');
  },
  add(pattern, style, system, description) {
    return db.prepare(
      'INSERT INTO rpg_image_triggers (pattern, style, system, description) VALUES (?, ?, ?, ?)'
    ).run(pattern, style, system, description);
  },
  update(id, data) {
    return db.prepare(
      'UPDATE rpg_image_triggers SET pattern = ?, style = ?, system = ?, description = ?, enabled = ? WHERE id = ?'
    ).run(data.pattern, data.style, data.system, data.description, data.enabled ? 1 : 0, id);
  },
  toggle(id, enabled) {
    return db.prepare('UPDATE rpg_image_triggers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  },
  delete(id) {
    return db.prepare('DELETE FROM rpg_image_triggers WHERE id = ?').run(id);
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

module.exports = { initRpgDatabase, getDb, campaigns, characters, gameLog, combat, sessions, imageTriggers, rpgSettings, artStyles };
