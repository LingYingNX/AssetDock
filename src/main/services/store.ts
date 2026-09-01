import type { Database } from 'better-sqlite3'

/** 标签默认色板(与设计稿标签色一致,超出按序循环) */
const TAG_COLORS = ['#22D3EE', '#F97316', '#3ECF8E', '#E8A33D', '#FF7A93', '#3B82F6', '#A855F7', '#64748B']

export interface LibraryRow {
  id: number
  name: string
  path: string
}

export interface AssetRow {
  id: number
  library_id: number
  rel_path: string
  name: string
  type: 'image' | 'video' | 'model'
  format: string
  width: number | null
  height: number | null
  duration: number | null
  face_count: number | null
  vertices: number | null
  material_info: string | null
  size_bytes: number
  mtime_ms: number
  fingerprint: string
  rating: number
  favorite: number
  review_flag: number
  note: string
  source_url: string | null
  deleted_at: string | null
  missing: number
  palette: string
  imported_at: string
  tags: { name: string; color: string }[]
}

export function createLibrary(d: Database, name: string, absPath: string): LibraryRow | { error: string } {
  const exists = d.prepare('SELECT id FROM libraries WHERE path = ?').get(absPath)
  if (exists) return { error: '该目录已绑定为素材库' }
  const info = d.prepare('INSERT INTO libraries(name, path) VALUES (?, ?)').run(name, absPath)
  return { id: Number(info.lastInsertRowid), name, path: absPath }
}

export function listLibraries(d: Database): LibraryRow[] {
  return d.prepare('SELECT id, name, path FROM libraries ORDER BY id').all() as LibraryRow[]
}

export function getLibrary(d: Database, id: number): LibraryRow | undefined {
  return d.prepare('SELECT id, name, path FROM libraries WHERE id = ?').get(id) as LibraryRow | undefined
}

/** 单库全量资产行(含标签),供渲染层过滤 */
export function listAssets(d: Database, libraryId: number): AssetRow[] {
  const rows = d
    .prepare('SELECT * FROM assets WHERE library_id = ? ORDER BY imported_at DESC, id DESC')
    .all(libraryId) as (Omit<AssetRow, 'tags'> & { tags?: unknown })[]
  const tagStmt = d.prepare(
    `SELECT t.name, t.color FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ?`
  )
  for (const r of rows) {
    r.tags = tagStmt.all(r.id) as { name: string; color: string }[]
  }
  return rows as AssetRow[]
}

export interface AssetPatch {
  name?: string
  rating?: number
  favorite?: number
  review_flag?: number
  note?: string
  source_url?: string | null
  deleted_at?: string | null
  palette?: string
  width?: number
  height?: number
  duration?: number
}

const EDITABLE = new Set(['name', 'rating', 'favorite', 'review_flag', 'note', 'source_url', 'deleted_at', 'palette', 'width', 'height', 'duration'])

export function updateAsset(d: Database, id: number, patch: AssetPatch): void {
  const keys = Object.keys(patch).filter((k) => EDITABLE.has(k))
  if (keys.length === 0) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  const vals = keys.map((k) => (patch as Record<string, unknown>)[k])
  d.prepare(`UPDATE assets SET ${sets} WHERE id = ?`).run(...vals, id)
}

export function setAssetMissing(d: Database, libraryId: number, relPath: string, missing: boolean): boolean {
  const r = d
    .prepare('UPDATE assets SET missing = ? WHERE library_id = ? AND rel_path = ?')
    .run(missing ? 1 : 0, libraryId, relPath)
  return r.changes > 0
}

export function addTag(d: Database, assetId: number, name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  const color = TAG_COLORS[Math.abs(hashStr(trimmed)) % TAG_COLORS.length]
  d.transaction(() => {
    let tag = d.prepare('SELECT id FROM tags WHERE name = ?').get(trimmed) as { id: number } | undefined
    if (!tag) tag = { id: Number(d.prepare('INSERT INTO tags(name, color) VALUES (?, ?)').run(trimmed, color).lastInsertRowid) }
    d.prepare('INSERT OR IGNORE INTO asset_tags(asset_id, tag_id) VALUES (?, ?)').run(assetId, tag.id)
  })()
}

export function removeTag(d: Database, assetId: number, name: string): void {
  d.prepare('DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)').run(assetId, name)
}

export interface ScanEntry {
  relPath: string
  name: string
  type: 'image' | 'video' | 'model'
  format: string
  sizeBytes: number
  mtimeMs: number
  fingerprint: string
  width?: number
  height?: number
  duration?: number
}

export function upsertScanned(d: Database, libraryId: number, entries: ScanEntry[]): void {
  const existing = d.prepare('SELECT id, size_bytes, mtime_ms FROM assets WHERE library_id = ? AND rel_path = ?')
  const insert = d.prepare(
    `INSERT INTO assets(library_id, rel_path, name, type, format, width, height, duration, size_bytes, mtime_ms, fingerprint, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const updateMeta = d.prepare('UPDATE assets SET size_bytes = ?, mtime_ms = ?, missing = 0 WHERE id = ?')
  const updateDims = d.prepare('UPDATE assets SET width = ?, height = ?, duration = ? WHERE id = ?')
  const now = new Date().toISOString().slice(0, 16)
  d.transaction(() => {
    for (const e of entries) {
      const row = existing.get(libraryId, e.relPath) as { id: number; size_bytes: number; mtime_ms: number } | undefined
      if (row) {
        updateMeta.run(e.sizeBytes, e.mtimeMs, row.id)
        if (e.width != null) updateDims.run(e.width, e.height ?? null, e.duration ?? null, row.id)
      } else {
        insert.run(libraryId, e.relPath, e.name, e.type, e.format, e.width ?? null, e.height ?? null, e.duration ?? null, e.sizeBytes, e.mtimeMs, e.fingerprint, now)
      }
    }
  })()
}

/* ---- 标签页持久化 ---- */

export function getOpenTabs(d: Database): { libraryId: number; position: number }[] {
  const rows = d.prepare('SELECT library_id, position FROM open_tabs ORDER BY position').all() as {
    library_id: number
    position: number
  }[]
  return rows.map((r) => ({ libraryId: r.library_id, position: r.position }))
}

export function saveOpenTabs(d: Database, libraryIds: number[]): void {
  d.transaction(() => {
    d.prepare('DELETE FROM open_tabs').run()
    const ins = d.prepare('INSERT INTO open_tabs(library_id, position) VALUES (?, ?)')
    libraryIds.forEach((id, i) => ins.run(id, i))
  })()
}

export function getAppState(d: Database, key: string): string | null {
  const r = d.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined
  return r?.value ?? null
}

export function setAppState(d: Database, key: string, value: string): void {
  d.prepare('INSERT INTO app_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}
