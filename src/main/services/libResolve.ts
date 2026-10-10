import { getDb } from './db'
import { getLibHandle, releaseLibHandle, hasLibDb, mediaDir } from './libraryDb'
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
export function libScopeDb(libraryId: number): { db: import('better-sqlite3').Database; libPath: string; own: boolean } | null {
  const lib = registryLib(libraryId)
  if (!lib) return null
  // own=true 表示 db 是引用计数加持的库句柄,用完必须配对 libScopeRelease
  return hasLibDb(lib.path)
    ? { db: getLibHandle(lib.path), libPath: lib.path, own: true }
    : { db: getDb(), libPath: lib.path, own: false }
}

/** 与 libScopeDb 配对:库句柄来源时释放引用计数;全局 db 是单例,无需释放 */
export function libScopeRelease(scope: { libPath: string; own: boolean } | null): void {
  if (!scope || !scope.own) return
  releaseLibHandle(scope.libPath)
}

/**
 * 校验绝对路径确实落在某个已注册库根内（realpath 解析符号链接后判定）。
 * shell 类操作（show-in-folder 等）一律先过这里，防止渲染层探测/打开库外路径。
 */
export async function resolveWithinAnyLibrary(absPath: string): Promise<string | null> {
  const libs = getDb().prepare('SELECT id, name, path FROM libraries').all() as LibraryRow[]
  for (const lib of libs) {
    const real = await realPathWithinRoot(lib.path, absPath)
    if (real) return real
  }
  return null
}

export { mediaDir }
