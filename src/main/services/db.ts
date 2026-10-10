import type Database from 'better-sqlite3'
import { join } from 'node:path'
import { openSqlite } from './sqlite'

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

const SCHEMA_V2 = `
ALTER TABLE assets ADD COLUMN codec TEXT;
ALTER TABLE assets ADD COLUMN fps REAL;
`

const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS index_sources (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

const SCHEMA_V4 = `
ALTER TABLE assets ADD COLUMN folder_path TEXT;
`

const SCHEMA_V5 = `
CREATE TABLE IF NOT EXISTS folder_orders (
  library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(library_id, path)
);
`

export function initDb(userDataDir: string): Database.Database {
  if (db) return db
  db = openSqlite(join(userDataDir, 'mediahub.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // 每个版本步进独立事务,成功后才推进 user_version:
  // 中断(进程被杀/断电)后重放是安全的——ALTER 先做幂等检查,CREATE 全部 IF NOT EXISTS
  const version = (db.pragma('user_version', { simple: true }) as number) ?? 0
  const step = (to: number, fn: () => void): void => {
    if (version >= to) return
    db!.transaction(fn)()
    db!.pragma(`user_version = ${to}`)
  }
  const columns = (t: string): string[] =>
    (db!.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name)

  step(1, () => { db!.exec(SCHEMA_V1) })
  step(2, () => {
    db!.exec(SCHEMA_V2)
  })
  step(3, () => {
    db!.exec(SCHEMA_V3)
    if (!columns('assets').includes('source_index_id')) {
      db!.exec('ALTER TABLE assets ADD COLUMN source_index_id INTEGER REFERENCES index_sources(id) ON DELETE CASCADE')
    }
  })
  step(4, () => {
    if (!columns('assets').includes('folder_path')) db!.exec(SCHEMA_V4)
  })
  step(5, () => { db!.exec(SCHEMA_V5) })
  return db
}

export function getDb(): Database.Database {
  if (!db) throw new Error('database not initialized')
  return db
}

/** 供测试使用 */
export function openMemoryDb(): Database.Database {
  const d = openSqlite(':memory:')
  d.exec(SCHEMA_V1)
  d.exec(SCHEMA_V2)
  d.exec(SCHEMA_V3)
  d.exec(SCHEMA_V4)
  d.exec(SCHEMA_V5)
  // source_index_id 的 ALTER 在 initDb 的 step(3) 里幂等执行,这里需单独补齐,
  // 否则 migrateLibrary 的 SELECT * 拿不到该列、INSERT 命名参数缺字段
  const cols = (d.pragma('table_info(assets)') as { name: string }[]).map((c) => c.name)
  if (!cols.includes('source_index_id')) {
    d.exec('ALTER TABLE assets ADD COLUMN source_index_id INTEGER REFERENCES index_sources(id) ON DELETE CASCADE')
  }
  return d
}
