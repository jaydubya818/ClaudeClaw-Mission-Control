-- ClaudeClaw memory schema. SQLite + FTS5.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Hive mind: every completed agent interaction.
CREATE TABLE IF NOT EXISTS hive_mind (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent      TEXT    NOT NULL,
  prompt     TEXT    NOT NULL,
  reply      TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hive_agent_time ON hive_mind(agent, created_at DESC);

-- Classified memories (Gemini extractor writes here every 30m).
CREATE TABLE IF NOT EXISTS memories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id      TEXT,
  agent        TEXT,
  content      TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('fact','preference','context')),
  importance   REAL    NOT NULL DEFAULT 0.5,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_mem_agent ON memories(agent);

-- Insights: higher-order observations Gemini infers.
CREATE TABLE IF NOT EXISTS insights (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  agent          TEXT,
  observation    TEXT    NOT NULL,
  confidence     REAL    NOT NULL DEFAULT 0.5,
  source_msg_ids TEXT,            -- JSON array
  created_at     INTEGER NOT NULL
);

-- Pinned memories (never decay, injected every session).
CREATE TABLE IF NOT EXISTS pinned (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  content    TEXT    NOT NULL,
  scope      TEXT    NOT NULL,      -- 'global' | 'main' | 'comms' | ...
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pinned_scope ON pinned(scope);

-- Importance audit trail.
CREATE TABLE IF NOT EXISTS importance_audit (
  memory_id INTEGER NOT NULL,
  old       REAL    NOT NULL,
  new       REAL    NOT NULL,
  reason    TEXT    NOT NULL,
  ts        INTEGER NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- Embeddings for semantic retrieval (Gemini 768-dim, stored as float32 BLOB).
CREATE TABLE IF NOT EXISTS embeddings (
  memory_id INTEGER PRIMARY KEY,
  vector    BLOB    NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- FTS5 index on memories.content for keyword fallback.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;

-- Tasks (mission control).
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  description  TEXT,
  agent        TEXT,                 -- NULL until auto-assigned
  priority     TEXT    NOT NULL DEFAULT 'medium',
  status       TEXT    NOT NULL DEFAULT 'queued',  -- queued|live|done|failed
  result       TEXT,                 -- agent reply when status='done'
  error        TEXT,                 -- failure reason when status='failed'
  cost_usd     REAL    DEFAULT 0,
  tokens       INTEGER DEFAULT 0,
  started_at   INTEGER,              -- when status flipped to 'live'
  finished_at  INTEGER,              -- when status flipped to 'done'/'failed'
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON tasks(agent, status);

-- Scheduled tasks (mutable mission editor — V3 transcript ch.10).
-- Coexists with scheduler/cron.yaml: yaml stays the source of truth for
-- code-managed missions; this table holds user-edited / dashboard-created ones.
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  schedule     TEXT    NOT NULL,        -- raw cron expression
  agent        TEXT    NOT NULL,
  prompt       TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_run_at  INTEGER,
  last_status  TEXT,                    -- success|fail|skipped|null
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sched_enabled ON scheduled_tasks(enabled);

-- Audit table (V3 page 10). Mirrors security/audit.log but indexed for UI.
CREATE TABLE IF NOT EXISTS audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  agent           TEXT,
  action          TEXT    NOT NULL,    -- e.g. "edit_agent_yaml", "send_telegram", "kill_switch_flip"
  correlation_id  TEXT,
  payload_hash    TEXT,                 -- truncated content hash, never raw
  pinned          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit(agent);

-- Usage table (V3 transcript: tokens / cost per turn).
CREATE TABLE IF NOT EXISTS usage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent        TEXT    NOT NULL,
  ts           INTEGER NOT NULL,
  input_tok    INTEGER NOT NULL DEFAULT 0,
  output_tok   INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL    NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_agent_ts ON usage(agent, ts DESC);
