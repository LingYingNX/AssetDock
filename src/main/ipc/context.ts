import { BrowserWindow } from 'electron'
import { join as joinPath } from 'node:path'
import { getDb } from '../services/db'
import { getLibrary } from '../services/store'
import { getLibHandle, hasLibDb, releaseLibHandle } from '../services/libraryDb'

/** 单窗口取用(dialog 等面向具体窗口的场景用;广播一律走 events.send) */
export function win(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

export function libRootOf(libraryId: number): string | null {
  return getLibrary(getDb(), libraryId)?.path ?? null
}

export interface Scope {
  db: ReturnType<typeof getDb>
  libPath: string
  /** 库句柄来源时为 true:用完必须调 release() 配对释放,否则句柄永远无法被 LRU 驱逐 */
  readonly own: boolean
}

/** 库的有效 db:库内 .mediahub/library.db;迁移失败/未迁移回退全局 db。纯查表,无副作用(S1-2) */
export function scopeFor(libraryId: number): Scope | null {
  const lib = getLibrary(getDb(), libraryId)
  if (!lib) return null
  const migrated = hasLibDb(lib.path)
  const db = migrated ? getLibHandle(lib.path) : getDb()
  return { db, libPath: lib.path, own: migrated }
}

/** Scope 用完统一从这里释放:库句柄路径配对 releaseLibHandle,全局 db 是单例不用释放 */
export function releaseScope(s: Scope): void {
  if (s.own) releaseLibHandle(s.libPath)
}

export function absPathFor(s: Scope, relPath: string): string {
  return joinPath(s.libPath, relPath)
}
