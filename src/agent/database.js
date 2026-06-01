// ---------------------------------------------------------------------------
// src/agent/database.js
//
// Manages haven-agent.db — separate from haven-bot.db.
// Contains conversation history, persistent memory, channel config, tool log.
// ---------------------------------------------------------------------------

const Database = require('better-sqlite3');
const path     = require('path');

let db;

function initAgentDatabase() {
  const dbPath = process.env.AGENT_DB_PATH ||
    (process.env.DB_PATH
      ? path.join(path.dirname(process.env.DB_PATH), 'haven-agent.db')
      : path.join(process.cwd(), 'haven-agent.db'));

  console.log(`✅ Agent database: ${dbPath}`);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Per-channel agent configuration overrides
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_channels (
      channel_id    TEXT PRIMARY KEY,
      agent_name    TEXT,
      agent_command TEXT,
      agent_mode    TEXT,
      system_prompt TEXT,
      cooldown      INTEGER,
      enabled       BOOLEAN DEFAULT 1,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Rolling conversation history per channel
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      role       TEXT NOT NULL,
      username   TEXT,
      content    TEXT NOT NULL,
      timestamp  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_channel
    ON conversations (channel_id, timestamp)
  `);

  // Persistent memory — per user or per channel
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL,
      scope_id   TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (scope, scope_id, key)
    )
  `);

  // Tool call audit log
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT,
      tool_name  TEXT,
      arguments  TEXT,
      result     TEXT,
      timestamp  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return db;
}

// ---------------------------------------------------------------------------
// Conversation history
// ---------------------------------------------------------------------------
const conversations = {
  add(channelId, role, content, username = null) {
    db.prepare(
      'INSERT INTO conversations (channel_id, role, username, content) VALUES (?, ?, ?, ?)'
    ).run(channelId, role, username, content);
  },

  getHistory(channelId, limit = 20) {
    return db.prepare(`
      SELECT role, username, content FROM conversations
      WHERE channel_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(channelId, limit).reverse();
  },

  clear(channelId) {
    db.prepare('DELETE FROM conversations WHERE channel_id = ?').run(channelId);
  },

  // Trim history to keep only the most recent N entries
  trim(channelId, maxSize) {
    const count = db.prepare(
      'SELECT COUNT(*) as count FROM conversations WHERE channel_id = ?'
    ).get(channelId).count;

    if (count > maxSize) {
      db.prepare(`
        DELETE FROM conversations WHERE id IN (
          SELECT id FROM conversations WHERE channel_id = ?
          ORDER BY timestamp ASC LIMIT ?
        )
      `).run(channelId, count - maxSize);
    }
  },
};

// ---------------------------------------------------------------------------
// Persistent memory
// ---------------------------------------------------------------------------
const memory = {
  set(scope, scopeId, key, value) {
    db.prepare(`
      INSERT INTO memory (scope, scope_id, key, value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (scope, scope_id, key) DO UPDATE SET value = excluded.value
    `).run(scope, scopeId, key, value);
  },

  get(scope, scopeId, key) {
    return db.prepare(
      'SELECT value FROM memory WHERE scope = ? AND scope_id = ? AND key = ?'
    ).get(scope, scopeId, key);
  },

  getAll(scope, scopeId) {
    return db.prepare(
      'SELECT key, value FROM memory WHERE scope = ? AND scope_id = ?'
    ).all(scope, scopeId);
  },

  delete(scope, scopeId, key) {
    db.prepare(
      'DELETE FROM memory WHERE scope = ? AND scope_id = ? AND key = ?'
    ).run(scope, scopeId, key);
  },

  clear(scope, scopeId) {
    db.prepare('DELETE FROM memory WHERE scope = ? AND scope_id = ?').run(scope, scopeId);
  },
};

// ---------------------------------------------------------------------------
// Channel config
// ---------------------------------------------------------------------------
const agentChannels = {
  get(channelId) {
    return db.prepare('SELECT * FROM agent_channels WHERE channel_id = ?').get(channelId);
  },

  set(channelId, fields) {
    const existing = this.get(channelId);
    if (existing) {
      const updates = Object.keys(fields).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE agent_channels SET ${updates}, updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?`)
        .run(...Object.values(fields), channelId);
    } else {
      const cols = ['channel_id', ...Object.keys(fields)].join(', ');
      const vals = ['?', ...Object.keys(fields).map(() => '?')].join(', ');
      db.prepare(`INSERT INTO agent_channels (${cols}) VALUES (${vals})`)
        .run(channelId, ...Object.values(fields));
    }
  },

  reset(channelId) {
    db.prepare('DELETE FROM agent_channels WHERE channel_id = ?').run(channelId);
  },
};

// ---------------------------------------------------------------------------
// Tool log
// ---------------------------------------------------------------------------
const toolLog = {
  add(channelId, toolName, args, result) {
    db.prepare(
      'INSERT INTO tool_log (channel_id, tool_name, arguments, result) VALUES (?, ?, ?, ?)'
    ).run(channelId, toolName, JSON.stringify(args), JSON.stringify(result));
  },
};

function getDb() { return db; }

module.exports = {
  initAgentDatabase,
  getDb,
  conversations,
  memory,
  agentChannels,
  toolLog,
};
