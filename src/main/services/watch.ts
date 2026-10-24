import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
export type { FSWatcher }
import { stat } from 'node:fs/promises'
import { isIgnoredWatch, detectKind } from './ignore'
import { fingerprint } from './fingerprint'
import { probeVideo } from './videoMeta'
import { probeImageMeta } from './formatProbe'
import { upsertScanned, setAssetMissing, type ScanUpsertResult } from './store'
import type { Database } from 'better-sqlite3'

export interface WatchCallbacks {
  onAdded: (assetId: number | null) => void
  /** change 事件:upsertOne 已拿到 assetId 时传入,S1-7 增量通知;目录级变化传 null 走全量 */
  onChanged: (assetId: number | null) => void
  onMissing: (relPath: string) => void
}

// S3-8:LRU 上限防大目录树峰值时 Map 无界增长(key 会在触发时自清,这里只兜底)
const DEBOUNCE_LRU_MAX = 4096
const debounces = new Map<string, NodeJS.Timeout>()

export const WATCH_OPTIONS = {
  ignoreInitial: true,
  usePolling: false,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
} as const

function debounced(key: string, fn: () => void, ms = 300): void {
  const previous = debounces.get(key)
  if (previous) clearTimeout(previous)
  else if (debounces.size >= DEBOUNCE_LRU_MAX) {
    // Map 迭代序即插入序:淘汰最旧未触发的条目
    const oldest = debounces.keys().next().value
    if (oldest !== undefined) {
      const t = debounces.get(oldest)
      if (t) clearTimeout(t)
      debounces.delete(oldest)
    }
  }
  debounces.set(key, setTimeout(() => {
    debounces.delete(key)
    fn()
  }, ms))
}

async function upsertOne(db: Database, libraryId: number, root: string, absPath: string): Promise<ScanUpsertResult | null> {
  const relPath = absPath.slice(root.length + 1).replace(/\\/g, '/')
  if (isIgnoredWatch(relPath)) return null
  const kind = detectKind(relPath)
  if (!kind) return null
  const state = await stat(absPath).catch(() => null)
  if (!state) return null
  let meta: { width?: number; height?: number; duration?: number; codec?: string; fps?: number } = {}
  if (kind.type === 'image') {
    meta = await probeImageMeta(absPath, relPath)
  } else if (kind.type === 'video') {
    meta = await probeVideo(absPath)
  }
  const [result] = upsertScanned(db, libraryId, [{
    relPath,
    name: relPath.slice(relPath.lastIndexOf('/') + 1, relPath.lastIndexOf('.')),
    type: kind.type,
    format: kind.format,
    sizeBytes: state.size,
    mtimeMs: state.mtimeMs,
    fingerprint: await fingerprint(absPath, state.size, state.mtimeMs).catch(() => 'na'),
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
    codec: meta.codec,
    fps: meta.fps
  }])
  // 新增/内容变化的图片:通知渲染层前先按原文件抽好主色,失败静默保持空
  if (result && kind.type === 'image') {
    try {
      const { extractPaletteFromImage } = await import('./palette')
      const palette = await extractPaletteFromImage(absPath)
      if (palette.length > 0) {
        db.prepare('UPDATE assets SET palette = ? WHERE id = ?').run(JSON.stringify(palette), result.assetId)
      }
    } catch { /* 主色留空 */ }
  }
  return result ?? null
}

/** 绑定资源库目录的增量监听；只处理该库自身的原始素材。 */
export function watchLibrary(db: Database, libraryId: number, root: string, cb: WatchCallbacks): FSWatcher {
  const watcher = chokidarWatch(root, {
    ...WATCH_OPTIONS,
    ignored: (path: string) => {
      const rel = path.slice(root.length + 1).replace(/\\/g, '/')
      return !!rel && !rel.startsWith('..') && isIgnoredWatch(rel)
    }
  })
  watcher
    .on('add', (path: string) => debounced(path, () => {
      void upsertOne(db, libraryId, root, path).then((result) => {
        if (result) cb.onAdded(result.assetId)
      }).catch(() => cb.onChanged(null))
    }))
    .on('change', (path: string) => debounced(path, () => {
      void upsertOne(db, libraryId, root, path).then(
        (result) => cb.onChanged(result ? result.assetId : null),
        () => cb.onChanged(null)
      )
    }))
    .on('unlink', (path: string) => debounced(`unlink:${path}`, () => {
      const relPath = path.slice(root.length + 1).replace(/\\/g, '/')
      if (setAssetMissing(db, libraryId, relPath, true)) cb.onMissing(relPath)
    }))
    .on('addDir', (path: string) => { if (path !== root) cb.onChanged(null) })
    .on('unlinkDir', (path: string) => { if (path !== root) cb.onChanged(null) })
  return watcher
}
