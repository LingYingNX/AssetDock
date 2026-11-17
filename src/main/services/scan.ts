import { readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { isIgnored, isIgnoredDir, detectKind } from './ignore'
import { fingerprint } from './fingerprint'
import { probeVideo } from './videoMeta'
import { probeImageMeta } from './formatProbe'
import { probeDocumentMeta } from './documentMeta'
import type { ScanEntry } from './store'

const SCAN_BATCH_SIZE = 64
/** 全局限流:8 个目录 × 64 个文件会同时打几百个 stat,机械盘上会把 folders:list 排到后面 */
const FILE_CONCURRENCY = 24

/** 对账用的已知行:size/mtime 一致时可直接沿用旧指纹,跳过读文件与元数据探测 */
export interface KnownScanFile {
  sizeBytes: number
  mtimeMs: number
  fingerprint: string
}

function scannedName(relPath: string): string {
  return basename(relPath, relPath.lastIndexOf('.') > 0 ? relPath.slice(relPath.lastIndexOf('.')) : '')
}

/** 单文件元数据采集(尺寸/时长/编码/面数按类型) */
async function collectEntry(absPath: string, relPath: string, sizeBytes: number, mtimeMs: number): Promise<ScanEntry | null> {
  const kind = detectKind(relPath)
  if (!kind) return null
  const entry: ScanEntry = {
    relPath,
    name: scannedName(relPath),
    type: kind.type,
    format: kind.format,
    sizeBytes,
    mtimeMs,
    fingerprint: await fingerprint(absPath, sizeBytes, mtimeMs)
  }
  if (kind.type === 'image') {
    const meta = await probeImageMeta(absPath, relPath)
    entry.width = meta.width
    entry.height = meta.height
  }
  if (kind.type === 'video') {
    const meta = await probeVideo(absPath)
    entry.duration = meta.duration
    entry.width = meta.width
    entry.height = meta.height
    entry.codec = meta.codec
    entry.fps = meta.fps
  }
  if (kind.type === 'document') {
    const meta = await probeDocumentMeta(absPath, kind.format)
    entry.pageCount = meta.pageCount
    entry.sheetCount = meta.sheetCount
    entry.slideCount = meta.slideCount
    entry.textEncoding = meta.textEncoding
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
  onProgress?: (done: number) => void,
  onError?: (relPath: string, error: unknown) => void,
  onBatch?: (entries: ScanEntry[]) => void,
  known?: ReadonlyMap<string, KnownScanFile>
): Promise<ScanEntry[]> {
  const entries: ScanEntry[] = []
  const queue: string[] = ['']
  let done = 0
  let errors = 0
  let active = 0
  const waiting: (() => void)[] = []
  const withFileSlot = async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= FILE_CONCURRENCY) {
      await new Promise<void>((resolve) => waiting.push(resolve))
    } else {
      active++
    }
    try {
      return await work()
    } finally {
      // 名额直接交给下一个等待者,active 不变;没人等才真正释放
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }

  async function walk(relDir: string): Promise<void> {
    const absDir = join(root, relDir)
    const batch: Promise<void>[] = []
    const batchEntries: ScanEntry[] = []
    const flushBatch = (): void => {
      if (batchEntries.length === 0) return
      const ready = batchEntries.splice(0)
      onBatch?.(ready)
    }
    let dirents
    try {
      dirents = await readdir(absDir, { withFileTypes: true })
    } catch (error) {
      // S3-6:目录不可读计入错误而非静默跳过
      errors++
      onError?.(relDir, error)
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
      batch.push(withFileSlot(async () => {
        const st = await stat(abs).catch((error: unknown) => {
          errors++
          onError?.(rel, error)
          return null
        })
        if (!st) return
        // 启动对账:size+mtime 未变 => 内容视为未变,沿用旧指纹,不再读 64KB/探测元数据。
        // shortcut: 保留 size+mtime 但改了内容的文件要等监听事件才会刷新,正常写入必改 mtime。
        const prev = known?.get(rel)
        if (prev && prev.sizeBytes === st.size && prev.mtimeMs === st.mtimeMs) {
          const kind = detectKind(rel)
          if (!kind) return
          const entry: ScanEntry = {
            relPath: rel,
            name: scannedName(rel),
            type: kind.type,
            format: kind.format,
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
            fingerprint: prev.fingerprint
          }
          entries.push(entry)
          batchEntries.push(entry)
          done++
          if (onProgress && done % 20 === 0) onProgress(done)
          return
        }
        const entry = await collectEntry(abs, rel, st.size, st.mtimeMs).catch((error: unknown) => {
          errors++
          onError?.(rel, error)
          return null
        })
        if (!entry) return
        entries.push(entry)
        batchEntries.push(entry)
        done++
        if (onProgress && done % 20 === 0) onProgress(done)
      }))
      if (batch.length >= SCAN_BATCH_SIZE) {
        await Promise.all(batch.splice(0))
        flushBatch()
      }
    }
    await Promise.all(batch)
    flushBatch()
  }

  while (queue.length > 0) {
    const batch = queue.splice(0, 8)
    await Promise.all(batch.map(walk))
  }
  onProgress?.(done)
  // S3-6:失败计数挂到返回值,调用方随 done 事件外报
  ;(entries as ScanEntry[] & { __errors?: number }).__errors = errors
  return entries
}
