import Database from 'better-sqlite3'
import { join, dirname } from 'node:path'
import { mkdirSync, existsSync, renameSync, rmSync, copyFileSync, readdirSync } from 'node:fs'

/** 每库 .mediahub/library.db;registry(全局库注册表)仍存全局 db */

const PER_LIB_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS index_sources (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  library_id INTEGER NOT NULL DEFAULT 1,
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
  codec TEXT,
  fps REAL,
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
  source_index_id INTEGER REFERENCES index_sources(id) ON DELETE CASCADE,
  UNIQUE(library_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_assets_lib ON assets(library_id);
CREATE INDEX IF NOT EXISTS idx_assets_fp ON assets(fingerprint);
CREATE INDEX IF NOT EXISTS idx_assets_src ON assets(source_index_id);
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  UNIQUE(asset_id, tag_id)
);
CREATE TABLE IF NOT EXISTS open_tabs (
  library_id INTEGER PRIMARY KEY,
  position INTEGER NOT NULL
);
`

export function mediaDir(libPath: string): string {
  return join(libPath, '.mediahub')
}
export function libDbPath(libPath: string): string {
  return join(mediaDir(libPath), 'library.db')
}
export function libThumbsDir(libPath: string): string {
  return join(mediaDir(libPath), 'thumbs')
}

/** 打开(或创建)库内 db;句柄缓存由调用方管理 */
export function openLibDb(libPath: string): Database.Database {
  mkdirSync(libThumbsDir(libPath), { recursive: true })
  const db = new Database(libDbPath(libPath))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(PER_LIB_SCHEMA)
  return db
}

/** 库内 db 是否已存在 */
export function hasLibDb(libPath: string): boolean {
  return existsSync(libDbPath(libPath))
}

/**
 * 复制式迁移:全局 db 中 libraryId 的数据 → <libPath>/.mediahub/library.db
 * 临时文件 + 原子 rename;源数据保留;同时拷贝全局 thumbs 缓存(按文件名去重)。
 * 返回 true=新建迁移,false=已存在跳过;抛错=失败(临时文件清理)。
 */
export function migrateLibrary(
  globalDb: Database.Database,
  lib: { id: number; path: string; name: string },
  globalThumbsDir: string
): boolean {
  if (hasLibDb(lib.path)) return false
  mkdirSync(mediaDir(lib.path), { recursive: true })
  const tmp = libDbPath(lib.path) + `.tmp-${process.pid}`
  try {
    const db = new Database(tmp)
    db.pragma('journal_mode = WAL')
    db.exec(PER_LIB_SCHEMA)
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO meta(key, value) VALUES ('name', ?), ('library_id', ?)").run(lib.name, String(lib.id))
      const assets = globalDb.prepare('SELECT * FROM assets WHERE library_id = ?').all(lib.id) as Record<string, unknown>[]
      const insAsset = db.prepare(
        `INSERT INTO assets(rel_path, name, type, format, width, height, duration, face_count, vertices, material_info, codec, fps,
          size_bytes, mtime_ms, fingerprint, rating, favorite, review_flag, note, source_url, deleted_at, missing, palette, imported_at)
         VALUES (@rel_path, @name, @type, @format, @width, @height, @duration, @face_count, @vertices, @material_info, @codec, @fps,
          @size_bytes, @mtime_ms, @fingerprint, @rating, @favorite, @review_flag, @note, @source_url, @deleted_at, @missing, @palette, @imported_at)`
      )
      const idMap = new Map<number, number>()
      for (const a of assets) {
        const info = insAsset.run(a)
        idMap.set(a.id as number, Number(info.lastInsertRowid))
      }
      // 标签:仅本库引用的
      const tagRows = globalDb
        .prepare(
          `SELECT DISTINCT t.id, t.name, t.color FROM tags t
           JOIN asset_tags at ON at.tag_id = t.id
           JOIN assets a ON a.id = at.asset_id AND a.library_id = ?`
        )
        .all(lib.id) as { id: number; name: string; color: string }[]
      const tagMap = new Map<number, number>()
      for (const t of tagRows) tagMap.set(t.id, Number(db.prepare('INSERT INTO tags(name, color) VALUES (?, ?)').run(t.name, t.color).lastInsertRowid))
      const insAt = db.prepare('INSERT OR IGNORE INTO asset_tags(asset_id, tag_id) VALUES (?, ?)')
      for (const a of assets) {
        const links = globalDb.prepare('SELECT tag_id FROM asset_tags WHERE asset_id = ?').all(a.id) as { tag_id: number }[]
        for (const l of links) {
          const newAsset = idMap.get(a.id as number)
          const newTag = tagMap.get(l.tag_id)
          if (newAsset != null && newTag != null) insAt.run(newAsset, newTag)
        }
      }
      // open_tabs:仅指向本库的
      const tab = globalDb.prepare('SELECT position FROM open_tabs WHERE library_id = ?').get(lib.id) as { position: number } | undefined
      if (tab) db.prepare('INSERT INTO open_tabs(library_id, position) VALUES (1, ?)').run(tab.position)
    })
    tx()
    db.close()
    renameSync(tmp, libDbPath(lib.path))
    // 缩略图缓存拷贝(按文件名去重)
    try {
      mkdirSync(libThumbsDir(lib.path), { recursive: true })
      for (const f of readdirSync(globalThumbsDir)) {
        const dst = join(libThumbsDir(lib.path), f)
        if (!existsSync(dst)) copyFileSync(join(globalThumbsDir, f), dst)
      }
    } catch { /* 缓存缺失可再生成 */ }
    return true
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    throw e
  }
}

/** 句柄 LRU(上限 8) */
const handles = new Map<string, Database.Database>()
const MAX_HANDLES = 8

export function getLibHandle(libPath: string): Database.Database {
  let h = handles.get(libPath)
  if (h) {
    handles.delete(libPath)
    handles.set(libPath, h)
    return h
  }
  h = openLibDb(libPath)
  handles.set(libPath, h)
  while (handles.size > MAX_HANDLES) {
    const oldest = handles.keys().next().value as string
    const old = handles.get(oldest)
    handles.delete(oldest)
    try { old?.close() } catch { /* ignore */ }
  }
  return h
}

export function closeAllLibHandles(): void {
  for (const h of handles.values()) {
    try { h.close() } catch { /* ignore */ }
  }
  handles.clear()
}

/** 测试辅助:内存库(同 schema) */
export function openMemoryLibDb(): Database.Database {
  const d = new Database(':memory:')
  d.exec(PER_LIB_SCHEMA)
  return d
}

export { dirname }
