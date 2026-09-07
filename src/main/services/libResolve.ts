import { getDb } from './db'
import { getLibHandle, hasLibDb, mediaDir, libThumbsDir } from './libraryDb'
import { promises as fsp } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { LibraryRow } from './store'
import { indexCachePaths } from './indexCache'

const INDEX_PATH_PREFIX = '@index:'

export interface IndexRow {
  id: number
  path: string
  name: string
}

export function indexPathPrefix(sourceIndexId: number): string {
  return `${INDEX_PATH_PREFIX}${sourceIndexId}`
}

export function canonicalIndexRelPath(sourceIndexId: number, sourceRelPath: string): string {
  return `${indexPathPrefix(sourceIndexId)}/${sourceRelPath.replace(/^[/\\]+/, '')}`
}

export function sourceRelativePath(relPath: string, sourceIndexId: number): string | null {
  const prefix = indexPathPrefix(sourceIndexId) + '/'
  return relPath.startsWith(prefix) ? relPath.slice(prefix.length) : null
}

/** 将旧的“显示名/源内路径”记录收敛为不会随显示名碰撞的内部键。 */
export function normalizeIndexedPaths(db: Database, libraryId: number, indexes: IndexRow[]): void {
  const byId = new Map(indexes.map((index) => [index.id, index]))
  const rows = db
    .prepare('SELECT id, rel_path, source_index_id FROM assets WHERE library_id = ? AND source_index_id IS NOT NULL')
    .all(libraryId) as { id: number; rel_path: string; source_index_id: number }[]
  if (rows.length === 0) return
  const update = db.prepare('UPDATE assets SET rel_path = ? WHERE id = ?')
  db.transaction(() => {
    for (const row of rows) {
      const index = byId.get(row.source_index_id)
      if (!index) continue
      const sourceRel = sourceRelativePath(row.rel_path, row.source_index_id)
        ?? (row.rel_path.startsWith(index.name + '/') ? row.rel_path.slice(index.name.length + 1) : row.rel_path)
      const canonical = canonicalIndexRelPath(row.source_index_id, sourceRel)
      if (canonical !== row.rel_path) update.run(canonical, row.id)
    }
  })()
}

export function isPathWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\'))
}

export async function realPathWithinRoot(root: string, target: string): Promise<string | null> {
  const realRoot = await fsp.realpath(root).catch(() => null)
  const realTarget = await fsp.realpath(target).catch(() => null)
  return realRoot && realTarget && isPathWithinRoot(realRoot, realTarget) ? realTarget : null
}

/** 注册表中的库行 */
export function registryLib(id: number): LibraryRow | undefined {
  return getDb().prepare('SELECT id, name, path FROM libraries WHERE id = ?').get(id) as LibraryRow | undefined
}

/** 库的有效 db:库内 .mediahub/library.db 优先;迁移失败/未迁移回退全局 db */
export function libScopeDb(libraryId: number): { db: import('better-sqlite3').Database; libPath: string } | null {
  const lib = registryLib(libraryId)
  if (!lib) return null
  if (hasLibDb(lib.path)) {
    const db = getLibHandle(lib.path)
    normalizeIndexedPaths(db, libraryId, listIndexes(lib.path))
    return { db, libPath: lib.path }
  }
  return { db: getDb(), libPath: lib.path } // 回退:全局兜底(迁移失败场景)
}

/** 由 rel_path 还原绝对路径(索引素材 = 索引根 + 去前缀段) */
export function absPathOf(libPath: string, relPath: string, indexPath: string | null, sourceIndexId: number | null): string {
  if (indexPath && sourceIndexId != null) {
    const sourceRel = sourceRelativePath(relPath, sourceIndexId)
    if (sourceRel != null) return join(indexPath, sourceRel)
  }
  return join(libPath, relPath)
}

export function listIndexes(libPath: string): IndexRow[] {
  return getLibHandle(libPath).prepare('SELECT id, path, name FROM index_sources ORDER BY id').all() as IndexRow[]
}

/** 指纹跨库查找:遍历注册库句柄,返回首个未缺失命中及其实际缩略图文件。 */
export function findByFingerprint(
  fingerprint: string,
  fallbackThumbsDir?: string,
  registryDb: Database = getDb()
): {
  assetId: number
  libraryId: number
  db: Database
  absPath: string
  type: 'image' | 'video' | 'model'
  format: string
  libRoot: string
  thumbPath: string
  sourceRelPath: string | null
  sidecarPath: string | null
} | null {
  const libs = registryDb.prepare('SELECT id, name, path FROM libraries').all() as LibraryRow[]
  for (const lib of libs) {
    if (!hasLibDb(lib.path)) {
      if (!fallbackThumbsDir) continue
      const row = registryDb
        .prepare(
          `SELECT id, rel_path, type, format FROM assets
           WHERE library_id = ? AND fingerprint = ? AND missing = 0 AND source_index_id IS NULL LIMIT 1`
        )
        .get(lib.id, fingerprint) as { id: number; rel_path: string; type: 'image' | 'video' | 'model'; format: string } | undefined
      if (row) {
        return {
          assetId: row.id,
          libraryId: lib.id,
          db: registryDb,
          absPath: join(lib.path, row.rel_path),
          type: row.type,
          format: row.format,
          libRoot: lib.path,
          thumbPath: join(fallbackThumbsDir, `${fingerprint}.webp`),
          sourceRelPath: null,
          sidecarPath: null
        }
      }
      continue
    }
    const db = getLibHandle(lib.path)
    normalizeIndexedPaths(db, lib.id, listIndexes(lib.path))
    let row: { id: number; rel_path: string; type: 'image' | 'video' | 'model'; format: string; source_index_id: number | null; idx_path: string | null } | undefined
    try {
      row = db
        .prepare(
          `SELECT a.id, a.rel_path, a.type, a.format, a.source_index_id, s.path AS idx_path
           FROM assets a LEFT JOIN index_sources s ON s.id = a.source_index_id
           WHERE a.library_id = ? AND a.fingerprint = ? AND a.missing = 0 LIMIT 1`
        )
        .get(lib.id, fingerprint) as typeof row
    } catch {
      continue
    }
    if (row) {
      const sourceRel = row.source_index_id != null ? sourceRelativePath(row.rel_path, row.source_index_id) : null
      if (row.source_index_id != null && sourceRel == null) continue
      const indexPaths = row.source_index_id != null && sourceRel != null ? indexCachePaths(lib.path, row.source_index_id, sourceRel) : null
      return {
        assetId: row.id,
        libraryId: lib.id,
        db,
        absPath: absPathOf(lib.path, row.rel_path, row.idx_path, row.source_index_id),
        type: row.type,
        format: row.format,
        libRoot: lib.path,
        thumbPath: join(libThumbsDir(lib.path), `${fingerprint}.webp`),
        sourceRelPath: sourceRel,
        sidecarPath: indexPaths?.sidecar ?? null
      }
    }
  }
  return null
}

export { mediaDir, libThumbsDir }
