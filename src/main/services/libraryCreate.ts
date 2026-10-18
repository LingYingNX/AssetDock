import { realpath, stat } from 'node:fs/promises'
import { dirname, parse, resolve } from 'node:path'

export type PickedPathMap = Map<string, number>

export const PICKED_PATH_TTL_MS = 10 * 60 * 1000

export function normalizePickedPath(path: string): string {
  return resolve(path).toLowerCase()
}

export function rememberPickedPath(paths: PickedPathMap, path: string, now = Date.now()): void {
  if (!path) return
  paths.set(normalizePickedPath(path), now)
}

export function isPickedPath(paths: PickedPathMap, path: string, now = Date.now()): boolean {
  const key = normalizePickedPath(path)
  const pickedAt = paths.get(key)
  if (pickedAt == null) return false
  if (now - pickedAt > PICKED_PATH_TTL_MS) {
    paths.delete(key)
    return false
  }
  return true
}

export function isDiskRoot(path: string): boolean {
  const real = resolve(path)
  return dirname(real) === real || parse(real).root.toLowerCase() === real.toLowerCase()
}

export async function validateLibraryCreatePath(
  paths: PickedPathMap,
  folderPath: string,
  now = Date.now()
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (typeof folderPath !== 'string' || !folderPath.trim()) return { ok: false, error: '请选择素材库目录' }
  if (!isPickedPath(paths, folderPath, now)) return { ok: false, error: '请通过目录选择器选择素材库目录' }

  const real = await realpath(folderPath).catch(() => null)
  if (!real) return { ok: false, error: '素材库目录不存在' }
  if (isDiskRoot(real)) return { ok: false, error: '不能把磁盘根目录绑定为素材库' }
  const state = await stat(real).catch(() => null)
  if (!state?.isDirectory()) return { ok: false, error: '素材库路径必须是目录' }
  return { ok: true, path: real }
}
