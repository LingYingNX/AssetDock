import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
export type { FSWatcher }
import { stat } from 'node:fs/promises'
import { isIgnoredWatch, detectKind } from './ignore'
import { fingerprint } from './fingerprint'
import { probeVideo } from './videoMeta'
import { upsertScanned, setAssetMissing, type ScanUpsertResult } from './store'
import type { Database } from 'better-sqlite3'

export interface WatchCallbacks {
  onAdded: (assetId: number | null) => void
  onChanged: () => void
  onMissing: (relPath: string) => void
}

const debounces = new Map<string, NodeJS.Timeout>()

export const WATCH_OPTIONS = {
  ignoreInitial: true,
  usePolling: false,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
} as const

function debounced(key: string, fn: () => void, ms = 300): void {
  const previous = debounces.get(key)
  if (previous) clearTimeout(previous)
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
  if (kind.type === 'image' && kind.format !== 'PSD') {
    meta = await (await import('sharp')).default(absPath).metadata().then((value) => ({ width: value.width, height: value.height }), () => ({}))
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
      }).catch(cb.onChanged)
    }))
    .on('change', (path: string) => debounced(path, () => {
      void upsertOne(db, libraryId, root, path).then(cb.onChanged, cb.onChanged)
    }))
    .on('unlink', (path: string) => debounced(`unlink:${path}`, () => {
      const relPath = path.slice(root.length + 1).replace(/\\/g, '/')
      if (setAssetMissing(db, libraryId, relPath, true)) cb.onMissing(relPath)
    }))
    .on('addDir', (path: string) => { if (path !== root) cb.onChanged() })
    .on('unlinkDir', (path: string) => { if (path !== root) cb.onChanged() })
  return watcher
}
