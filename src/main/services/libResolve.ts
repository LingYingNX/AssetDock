import { getDb } from './db'
import { getLibHandle, hasLibDb, mediaDir, libThumbsDir } from './libraryDb'
import { join } from 'node:path'
import type { LibraryRow } from './store'

export interface Scope {
  relPrefix: string // '' | '索引名/'
  sourceIndexId: number | null
}

/** 注册表中的库行 */
export function registryLib(id: number): LibraryRow | undefined {
  return getDb().prepare('SELECT id, name, path FROM libraries WHERE id = ?').get(id) as LibraryRow | undefined
}

/** 库的有效 db:库内 .mediahub/library.db 优先;迁移失败/未迁移回退全局 db */
export function libScopeDb(libraryId: number): { db: import('better-sqlite3').Database; libPath: string } | null {
  const lib = registryLib(libraryId)
  if (!lib) return null
  if (hasLibDb(lib.path)) return { db: getLibHandle(lib.path), libPath: lib.path }
  return { db: getDb(), libPath: lib.path } // 回退:全局兜底(迁移失败场景)
}

/** 由 rel_path 还原绝对路径(索引素材 = 索引根 + 去前缀段) */
export function absPathOf(libPath: string, relPath: string, indexPath: string | null, indexName: string | null): string {
  if (indexPath && indexName && relPath.startsWith(indexName + '/')) {
    return join(indexPath, relPath.slice(indexName.length + 1))
  }
  return join(libPath, relPath)
}

export interface IndexRow {
  id: number
  path: string
  name: string
}

export function listIndexes(libPath: string): IndexRow[] {
  return getLibHandle(libPath).prepare('SELECT id, path, name FROM index_sources ORDER BY id').all() as IndexRow[]
}

/** 指纹跨库查找:遍历注册库句柄,返回首个未缺失命中(含库内 thumbs 路径) */
export function findByFingerprint(
  fingerprint: string
): { absPath: string; type: 'image' | 'video' | 'model'; format: string; libRoot: string; thumbsDir: string } | null {
  const libs = getDb().prepare('SELECT id, name, path FROM libraries').all() as LibraryRow[]
  for (const lib of libs) {
    if (!hasLibDb(lib.path)) continue // 未迁移库的指纹查找暂不覆盖(迁移兜底路径走全局素材生成)
    let row: { rel_path: string; type: 'image' | 'video' | 'model'; format: string; idx_path: string | null; idx_name: string | null } | undefined
    try {
      row = getLibHandle(lib.path)
        .prepare(
          `SELECT a.rel_path, a.type, a.format, s.path AS idx_path, s.name AS idx_name
           FROM assets a LEFT JOIN index_sources s ON s.id = a.source_index_id
           WHERE a.fingerprint = ? AND a.missing = 0 LIMIT 1`
        )
        .get(fingerprint) as typeof row
    } catch {
      continue
    }
    if (row) {
      return {
        absPath: absPathOf(lib.path, row.rel_path, row.idx_path, row.idx_name),
        type: row.type,
        format: row.format,
        libRoot: lib.path,
        thumbsDir: libThumbsDir(lib.path)
      }
    }
  }
  return null
}

export { mediaDir, libThumbsDir }
