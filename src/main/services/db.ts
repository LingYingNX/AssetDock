import Database from 'better-sqlite3'
import { join } from 'node:path'

let db: Database.Database | null = null

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS libraries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  format TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration REAL,
  face_count INTEGER,
  vertices INTEGER,
  material_info TEXT,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  review_flag INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  deleted_at TEXT,
  missing INTEGER NOT NULL DEFAULT 0,
  palette TEXT NOT NULL DEFAULT '[]',
  imported_at TEXT NOT NULL,
  UNIQUE(library_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_assets_lib ON assets(library_id);
CREATE INDEX IF NOT EXISTS idx_assets_fp ON assets(fingerprint);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  UNIQUE(asset_id, tag_id)
);
CREATE TABLE IF NOT EXISTS open_tabs (
  library_id INTEGER PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export function initDb(userDataDir: string): Database.Database {
  if (db) return db
  db = new Database(join(userDataDir, 'mediahub.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const version = (db.pragma('user_version', { simple: true }) as number) ?? 0
  if (version < 1) {
    db.exec(SCHEMA_V1)
    db.pragma('user_version = 1')
  }
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('database not initialized')
  return db
}

/** 供测试使用 */
export function openMemoryDb(): Database.Database {
  const d = new Database(':memory:')
  d.exec(SCHEMA_V1)
  return d
}
