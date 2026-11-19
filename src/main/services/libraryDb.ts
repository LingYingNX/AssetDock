import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { mkdirSync, existsSync, renameSync, rmSync } from 'node:fs'
import { openSqlite } from './sqlite'

/** 每库 .mediahub/library.db;registry(全局库注册表)仍存全局 db */

const PER_LIB_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS index_sources (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'folder',
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
  page_count INTEGER,
  sheet_count INTEGER,
  slide_count INTEGER,
  text_encoding TEXT,
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
  folder_path TEXT,
  eagle_mtime_ms INTEGER,
  manual_order INTEGER,
  UNIQUE(library_id, rel_path)
);
CREATE INDEX IF NOT EXISTS idx_assets_lib ON assets(library_id);
CREATE INDEX IF NOT EXISTS idx_assets_lib_imported ON assets(library_id, imported_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_assets_fp ON assets(fingerprint);
CREATE INDEX IF NOT EXISTS idx_assets_src ON assets(source_index_id);
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  UNIQUE(asset_id, tag_id)
);
CREATE TABLE IF NOT EXISTS eagle_folders (
  source_index_id INTEGER NOT NULL REFERENCES index_sources(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  position INTEGER NOT NULL,
  order_by TEXT,
  sort_increase INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(source_index_id, path)
);
CREATE TABLE IF NOT EXISTS eagle_asset_folders (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  folder_path TEXT NOT NULL,
  PRIMARY KEY(asset_id, folder_path)
);
CREATE INDEX IF NOT EXISTS idx_eagle_asset_folders_path ON eagle_asset_folders(folder_path);
CREATE TABLE IF NOT EXISTS folder_orders (
  library_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(library_id, path)
);
CREATE TABLE IF NOT EXISTS folder_styles (
  library_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  PRIMARY KEY(library_id, path)
);CREATE TABLE IF NOT EXISTS purged_paths (
  library_id INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  purged_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(library_id, rel_path)
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
/** 打开(或创建)库内 db;句柄缓存由调用方管理 */
export function openLibDb(libPath: string): Database.Database {
  mkdirSync(mediaDir(libPath), { recursive: true })
  const db = openSqlite(libDbPath(libPath))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(PER_LIB_SCHEMA)
  const columns = db.pragma('table_info(assets)') as { name: string }[]
  if (!columns.some((column) => column.name === 'folder_path')) db.exec('ALTER TABLE assets ADD COLUMN folder_path TEXT')
  if (!columns.some((column) => column.name === 'eagle_mtime_ms')) db.exec('ALTER TABLE assets ADD COLUMN eagle_mtime_ms INTEGER')
  if (!columns.some((column) => column.name === 'manual_order')) db.exec('ALTER TABLE assets ADD COLUMN manual_order INTEGER')
  if (!columns.some((column) => column.name === 'page_count')) db.exec('ALTER TABLE assets ADD COLUMN page_count INTEGER')
  if (!columns.some((column) => column.name === 'sheet_count')) db.exec('ALTER TABLE assets ADD COLUMN sheet_count INTEGER')
  if (!columns.some((column) => column.name === 'slide_count')) db.exec('ALTER TABLE assets ADD COLUMN slide_count INTEGER')
  if (!columns.some((column) => column.name === 'text_encoding')) db.exec('ALTER TABLE assets ADD COLUMN text_encoding TEXT')
  const indexColumns = db.pragma('table_info(index_sources)') as { name: string }[]
  if (!indexColumns.some((column) => column.name === 'kind')) db.exec("ALTER TABLE index_sources ADD COLUMN kind TEXT NOT NULL DEFAULT 'folder'")
  return db
}

/** 库内 db 是否已存在 */
export function hasLibDb(libPath: string): boolean {
  return existsSync(libDbPath(libPath))
}

/**
 * 复制式迁移:全局 db 中 libraryId 的数据 → <libPath>/.mediahub/library.db
 * 临时文件 + 原子 rename;源数据保留。
 * 返回 true=新建迁移,false=已存在跳过;抛错=失败(临时文件清理)。
 */
export function migrateLibrary(
  globalDb: Database.Database,
  lib: { id: number; path: string; name: string }
): boolean {
  if (hasLibDb(lib.path)) return false
  mkdirSync(mediaDir(lib.path), { recursive: true })
  // S3-4:随机后缀避免多进程同时迁移同一库时 tmp 名碰撞
  const tmp = libDbPath(lib.path) + `.tmp-${randomUUID()}`
  try {
    const db = openSqlite(tmp)
    db.pragma('journal_mode = WAL')
    db.exec(PER_LIB_SCHEMA)
    const tx = db.transaction(() => {
      db.prepare("INSERT INTO meta(key, value) VALUES ('name', ?), ('library_id', ?)").run(lib.name, String(lib.id))
      const assets = globalDb.prepare('SELECT * FROM assets WHERE library_id = ?').all(lib.id) as Record<string, unknown>[]
      const sources = globalDb
        .prepare(
          'SELECT id, path, name, created_at FROM index_sources WHERE id IN (SELECT DISTINCT source_index_id FROM assets WHERE library_id = ? AND source_index_id IS NOT NULL)'
        )
        .all(lib.id) as { id: number; path: string; name: string; created_at: string }[]
      const insSource = db.prepare('INSERT INTO index_sources(id, path, name, created_at) VALUES (?, ?, ?, ?)')
      for (const source of sources) insSource.run(source.id, source.path, source.name, source.created_at)
      const insAsset = db.prepare(
        `INSERT INTO assets(library_id, rel_path, name, type, format, width, height, duration, face_count, vertices, material_info, codec, fps, page_count, sheet_count, slide_count, text_encoding,
          size_bytes, mtime_ms, fingerprint, rating, favorite, review_flag, note, source_url, deleted_at, missing, palette, imported_at, source_index_id, folder_path)
         VALUES (@library_id, @rel_path, @name, @type, @format, @width, @height, @duration, @face_count, @vertices, @material_info, @codec, @fps, @page_count, @sheet_count, @slide_count, @text_encoding,
          @size_bytes, @mtime_ms, @fingerprint, @rating, @favorite, @review_flag, @note, @source_url, @deleted_at, @missing, @palette, @imported_at, @source_index_id, @folder_path)`
      )
      const idMap = new Map<number, number>()
      for (const a of assets) {
        const info = insAsset.run({
          ...a,
          library_id: lib.id,
          folder_path: a.folder_path ?? null,
          page_count: a.page_count ?? null,
          sheet_count: a.sheet_count ?? null,
          slide_count: a.slide_count ?? null,
          text_encoding: a.text_encoding ?? null
        })
        idMap.set(a.id as number, Number(info.lastInsertRowid))
      }
      const folderOrders = globalDb.prepare('SELECT path, position FROM folder_orders WHERE library_id = ?').all(lib.id) as { path: string; position: number }[]
      const insFolderOrder = db.prepare('INSERT INTO folder_orders(library_id, path, position) VALUES (?, ?, ?)')
      for (const folder of folderOrders) insFolderOrder.run(lib.id, folder.path, folder.position)
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
    return true
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    throw e
  }
}

export function ensureLibraryStorage(
  globalDb: Database.Database,
  lib: { id: number; path: string; name: string }
): boolean {
  try {
    migrateLibrary(globalDb, lib)
    return hasLibDb(lib.path)
  } catch {
    return false
  }
}

/**
 * 句柄 LRU(上限 64)。句柄成本(一个 fd + WAL)远低于误关活跃句柄导致的
 * "connection is closed" 崩溃,故上限放宽;只有引用计数归零的句柄才允许驱逐关闭。
 */
const handles = new Map<string, Database.Database>()
/** 每个 libPath 的 in-flight 使用计数:getLibHandle/useLibHandle 配对释放 */
const inflight = new Map<string, number>()
const MAX_HANDLES = 64

function tryEvictLocked(): void {
  while (handles.size > MAX_HANDLES) {
    // 找最旧的引用计数为 0 的条目;全都被占用时宁可超上限也不 close 活跃句柄
    let victim: string | null = null
    for (const key of handles.keys()) {
      if ((inflight.get(key) ?? 0) === 0) { victim = key; break }
    }
    if (!victim) return
    const old = handles.get(victim)
    handles.delete(victim)
    try { old?.close() } catch { /* ignore */ }
  }
}

/** 获取句柄并把引用计数 +1;调用方必须用 releaseLibHandle 释放 */
export function getLibHandle(libPath: string): Database.Database {
  let h = handles.get(libPath)
  if (h) {
    handles.delete(libPath)
    handles.set(libPath, h)
  } else {
    h = openLibDb(libPath)
    handles.set(libPath, h)
  }
  inflight.set(libPath, (inflight.get(libPath) ?? 0) + 1)
  tryEvictLocked()
  return h
}

/** 与 getLibHandle 配对:引用计数归零后该句柄才可被 LRU 驱逐 */
export function releaseLibHandle(libPath: string): void {
  const n = (inflight.get(libPath) ?? 0) - 1
  if (n <= 0) inflight.delete(libPath)
  else inflight.set(libPath, n)
}

/** 测试辅助 */
export function hasLibHandle(libPath: string): boolean {
  return handles.has(libPath)
}

/** 测试辅助:当前缓存句柄数 */
export function cachedHandleCount(): number {
  return handles.size
}

export function closeAllLibHandles(): void {
  for (const h of handles.values()) {
    try { h.close() } catch { /* ignore */ }
  }
  handles.clear()
  inflight.clear()
}

/** 测试辅助:内存库(同 schema) */
export function openMemoryLibDb(): Database.Database {
  const d = openSqlite(':memory:')
  d.exec(PER_LIB_SCHEMA)
  return d
}

export { dirname }
