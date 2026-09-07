import type { Database } from 'better-sqlite3'
import { canonicalIndexRelPath } from './libResolve'

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
  codec: string | null
  fps: number | null
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
  source_index_id: number | null
  folder_path: string | null
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

/** 单个完整资产行(含标签),供索引 sidecar 物化使用。 */
export function assetById(d: Database, libraryId: number, assetId: number): AssetRow | undefined {
  const row = d.prepare('SELECT * FROM assets WHERE library_id = ? AND id = ?').get(libraryId, assetId) as
    | (Omit<AssetRow, 'tags'> & { tags?: unknown })
    | undefined
  if (!row) return undefined
  row.tags = d
    .prepare('SELECT t.name, t.color FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = ?')
    .all(assetId) as { name: string; color: string }[]
  return row as AssetRow
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
  codec?: string | null
  fps?: number | null
  face_count?: number | null
  vertices?: number | null
}

const EDITABLE = new Set([
  'name', 'rating', 'favorite', 'review_flag', 'note', 'source_url', 'deleted_at', 'palette',
  'width', 'height', 'duration', 'codec', 'fps', 'face_count', 'vertices'
])

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

export function setAssetFolder(d: Database, assetId: number, folderPath: string | null): void {
  d.prepare('UPDATE assets SET folder_path = ? WHERE id = ?').run(folderPath, assetId)
}

export function renameAssetFolder(d: Database, libraryId: number, oldPath: string, newPath: string): void {
  d.transaction(() => {
    d.prepare(
      `UPDATE assets
       SET rel_path = CASE
         WHEN rel_path = ? THEN ?
         ELSE ? || substr(rel_path, length(?) + 1)
       END
       WHERE library_id = ? AND source_index_id IS NULL AND (rel_path = ? OR instr(rel_path, ?) = 1)`
    ).run(oldPath, newPath, newPath, oldPath, libraryId, oldPath, `${oldPath}/`)
    d.prepare(
      `UPDATE assets
       SET folder_path = CASE
         WHEN folder_path = ? THEN ?
         ELSE ? || substr(folder_path, length(?) + 1)
       END
       WHERE library_id = ? AND (folder_path = ? OR instr(folder_path, ?) = 1)`
    ).run(oldPath, newPath, newPath, oldPath, libraryId, oldPath, `${oldPath}/`)
  })()
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
  codec?: string
  fps?: number
  faceCount?: number
  vertices?: number
}

export interface ScanUpsertResult {
  assetId: number
  action: 'added' | 'changed' | 'unchanged' | 'relocated'
  relPath: string
  previousRelPath?: string
}

export function upsertScanned(d: Database, libraryId: number, entries: ScanEntry[], sourceIndexId?: number): ScanUpsertResult[] {
  const existing = d.prepare(
    'SELECT id, size_bytes, mtime_ms, fingerprint, source_index_id FROM assets WHERE library_id = ? AND rel_path = ?'
  )
  const missingIndexed = d.prepare(
    `SELECT id, rel_path FROM assets
     WHERE library_id = ? AND source_index_id = ? AND fingerprint = ? AND missing = 1
     LIMIT 2`
  )
  const insert = d.prepare(
    `INSERT INTO assets(library_id, rel_path, name, type, format, width, height, duration, codec, fps, face_count, vertices, size_bytes, mtime_ms, fingerprint, source_index_id, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const updateScanned = d.prepare(
    `UPDATE assets
     SET name = ?, type = ?, format = ?, width = ?, height = ?, duration = ?, codec = ?, fps = ?, face_count = ?, vertices = ?,
         size_bytes = ?, mtime_ms = ?, fingerprint = ?, missing = 0
     WHERE id = ?`
  )
  const relocate = d.prepare('UPDATE assets SET rel_path = ?, source_index_id = ? WHERE id = ?')
  const now = new Date().toISOString().slice(0, 16)
  const results: ScanUpsertResult[] = []
  const writeScanned = (entry: ScanEntry, assetId: number): void => {
    updateScanned.run(
      entry.name,
      entry.type,
      entry.format,
      entry.width ?? null,
      entry.height ?? null,
      entry.duration ?? null,
      entry.codec ?? null,
      entry.fps ?? null,
      entry.faceCount ?? null,
      entry.vertices ?? null,
      entry.sizeBytes,
      entry.mtimeMs,
      entry.fingerprint,
      assetId
    )
  }
  d.transaction(() => {
    for (const e of entries) {
      const relPath = sourceIndexId != null ? canonicalIndexRelPath(sourceIndexId, e.relPath) : e.relPath
      const row = existing.get(libraryId, relPath) as
        | { id: number; size_bytes: number; mtime_ms: number; fingerprint: string; source_index_id: number | null }
        | undefined
      if (row) {
        const action =
          row.size_bytes === e.sizeBytes && row.mtime_ms === e.mtimeMs && row.fingerprint === e.fingerprint
            ? 'unchanged'
            : 'changed'
        writeScanned(e, row.id)
        if (sourceIndexId != null && row.source_index_id !== sourceIndexId) {
          d.prepare('UPDATE assets SET source_index_id = ? WHERE id = ?').run(sourceIndexId, row.id)
        }
        results.push({ assetId: row.id, action, relPath })
      } else if (sourceIndexId != null) {
        const candidates = missingIndexed.all(libraryId, sourceIndexId, e.fingerprint) as { id: number; rel_path: string }[]
        if (candidates.length === 1) {
          const previousRelPath = candidates[0].rel_path
          relocate.run(relPath, sourceIndexId, candidates[0].id)
          writeScanned(e, candidates[0].id)
          results.push({ assetId: candidates[0].id, action: 'relocated', relPath, previousRelPath })
        } else {
          const info = insert.run(
            libraryId,
            relPath,
            e.name,
            e.type,
            e.format,
            e.width ?? null,
            e.height ?? null,
            e.duration ?? null,
            e.codec ?? null,
            e.fps ?? null,
            e.faceCount ?? null,
            e.vertices ?? null,
            e.sizeBytes,
            e.mtimeMs,
            e.fingerprint,
            sourceIndexId,
            now
          )
          results.push({ assetId: Number(info.lastInsertRowid), action: 'added', relPath })
        }
      } else {
        const info = insert.run(
          libraryId,
          relPath,
          e.name,
          e.type,
          e.format,
          e.width ?? null,
          e.height ?? null,
          e.duration ?? null,
          e.codec ?? null,
          e.fps ?? null,
          e.faceCount ?? null,
          e.vertices ?? null,
          e.sizeBytes,
          e.mtimeMs,
          e.fingerprint,
          null,
          now
        )
        results.push({ assetId: Number(info.lastInsertRowid), action: 'added', relPath })
      }
    }
  })()
  return results
}

/** 新路径先被监听到时，合并临时索引记录并保留原记录的用户元数据。 */
export function mergeIndexedRename(
  d: Database,
  libraryId: number,
  sourceIndexId: number,
  oldSourceRel: string,
  newSourceRel: string
): number | null {
  const oldRel = canonicalIndexRelPath(sourceIndexId, oldSourceRel)
  const newRel = canonicalIndexRelPath(sourceIndexId, newSourceRel)
  const original = d
    .prepare('SELECT id, fingerprint FROM assets WHERE library_id = ? AND source_index_id = ? AND rel_path = ?')
    .get(libraryId, sourceIndexId, oldRel) as { id: number; fingerprint: string } | undefined
  const transient = d
    .prepare('SELECT id, fingerprint FROM assets WHERE library_id = ? AND source_index_id = ? AND rel_path = ?')
    .get(libraryId, sourceIndexId, newRel) as { id: number; fingerprint: string } | undefined
  if (!original || !transient || original.id === transient.id || original.fingerprint !== transient.fingerprint) return null
  d.transaction(() => {
    d.prepare('DELETE FROM assets WHERE id = ?').run(transient.id)
    d.prepare('UPDATE assets SET rel_path = ?, missing = 0 WHERE id = ?').run(newRel, original.id)
  })()
  return original.id
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
