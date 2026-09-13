import { getDb } from './db'
import { getLibHandle, hasLibDb, mediaDir } from './libraryDb'
import { promises as fsp } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import type { LibraryRow } from './store'

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

/** 库内 .mediahub/library.db 优先；迁移失败时回退到全局数据库。 */
export function libScopeDb(libraryId: number): { db: import('better-sqlite3').Database; libPath: string } | null {
  const lib = registryLib(libraryId)
  if (!lib) return null
  return { db: hasLibDb(lib.path) ? getLibHandle(lib.path) : getDb(), libPath: lib.path }
}

export { mediaDir }
