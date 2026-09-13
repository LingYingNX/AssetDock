import { readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import sharp from 'sharp'
import { isIgnored, isIgnoredDir, detectKind } from './ignore'
import { fingerprint } from './fingerprint'
import { probeVideo } from './videoMeta'
import type { ScanEntry } from './store'

const SCAN_BATCH_SIZE = 64

/** 单文件元数据采集(尺寸/时长/编码/面数按类型) */
async function collectEntry(absPath: string, relPath: string, sizeBytes: number, mtimeMs: number): Promise<ScanEntry | null> {
  const kind = detectKind(relPath)
  if (!kind) return null
  const entry: ScanEntry = {
    relPath,
    name: basename(relPath, relPath.lastIndexOf('.') > 0 ? relPath.slice(relPath.lastIndexOf('.')) : ''),
    type: kind.type,
    format: kind.format,
    sizeBytes,
    mtimeMs,
    fingerprint: await fingerprint(absPath, sizeBytes, mtimeMs)
  }
  if (kind.type === 'image' && kind.format !== 'PSD') {
    try {
      const meta = await sharp(absPath).metadata()
      entry.width = meta.width ?? undefined
      entry.height = meta.height ?? undefined
    } catch { /* 尺寸留空 */ }
  }
  if (kind.type === 'video') {
    const meta = await probeVideo(absPath)
    entry.duration = meta.duration
    entry.width = meta.width
    entry.height = meta.height
    entry.codec = meta.codec
    entry.fps = meta.fps
  }
  return entry
}

/** 扫描一组已知文件，供结构化素材库复用基础媒体元数据采集。 */
export async function scanPaths(
  root: string,
  relPaths: readonly string[],
  onProgress?: (done: number) => void
): Promise<ScanEntry[]> {
  const entries: ScanEntry[] = []
  let done = 0
  for (let start = 0; start < relPaths.length; start += SCAN_BATCH_SIZE) {
    const batch = await Promise.all(relPaths.slice(start, start + SCAN_BATCH_SIZE).map(async (relPath) => {
      const absPath = join(root, relPath)
      const st = await stat(absPath).catch(() => null)
      if (!st) return null
      return collectEntry(absPath, relPath, st.size, st.mtimeMs).catch(() => null)
    }))
    for (const entry of batch) {
      if (!entry) continue
      entries.push(entry)
      done++
      if (done % 20 === 0) onProgress?.(done)
    }
  }
  onProgress?.(done)
  return entries
}

/**
 * 递归扫描库目录:并发 8,忽略规则过滤,进度回调(每 20 个文件)。
 * 返回全部 ScanEntry,由调用方 upsert 入库。
 */
export async function scanLibrary(
  root: string,
  onProgress?: (done: number) => void
): Promise<ScanEntry[]> {
  const entries: ScanEntry[] = []
  const queue: string[] = ['']
  let done = 0

  async function walk(relDir: string): Promise<void> {
    const absDir = join(root, relDir)
    const batch: Promise<void>[] = []
    let dirents
    try {
      dirents = await readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const dent of dirents) {
      const rel = relDir ? `${relDir}/${dent.name}` : dent.name
      if (dent.isDirectory()) {
        if (!isIgnoredDir(rel)) queue.push(rel)
        continue
      }
      if (!dent.isFile() || isIgnored(rel)) continue
      const abs = join(root, rel)
      batch.push((async () => {
        const st = await stat(abs).catch(() => null)
        if (!st) return
        const entry = await collectEntry(abs, rel, st.size, st.mtimeMs).catch(() => null)
        if (!entry) return
        entries.push(entry)
        done++
        if (onProgress && done % 20 === 0) onProgress(done)
      })())
      if (batch.length >= SCAN_BATCH_SIZE) await Promise.all(batch.splice(0))
    }
    await Promise.all(batch)
  }

  while (queue.length > 0) {
    const batch = queue.splice(0, 8)
    await Promise.all(batch.map(walk))
  }
  onProgress?.(done)
  return entries
}
