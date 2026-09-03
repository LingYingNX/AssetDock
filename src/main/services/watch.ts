import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
export type { FSWatcher }
import { stat } from 'node:fs/promises'
import { isIgnoredWatch, detectKind } from './ignore'
import { fingerprint } from './fingerprint'
import { probeVideo } from './videoMeta'
import { upsertScanned, setAssetMissing } from './store'
import type { Database } from 'better-sqlite3'

export interface WatchCallbacks {
  onAdded: (assetId: number | null) => void
  onChanged: () => void
  onMissing: (relPath: string) => void
}

export interface WatchOptions {
  /** 索引根:upsert 的 rel 加此虚拟前缀(= 索引名) */
  relPrefix?: string
  /** 索引素材来源标记 */
  sourceIndexId?: number
  /** 库根 upsert 后回调(触发缩略图补齐) */
  onUpsert?: (assetId: number | null) => void
}

const debounces = new Map<string, NodeJS.Timeout>()

function debounced(key: string, fn: () => void, ms = 300): void {
  const prev = debounces.get(key)
  if (prev) clearTimeout(prev)
  debounces.set(
    key,
    setTimeout(() => {
      debounces.delete(key)
      fn()
    }, ms)
  )
}

/** 文件相对根的忽略判断(目录路径按段规则放行,不因无扩展名剪枝) */
function ignored(rel: string): boolean {
  return isIgnoredWatch(rel)
}

async function upsertOne(
  db: Database,
  libraryId: number,
  root: string,
  absPath: string,
  opts: WatchOptions | undefined
): Promise<number | null> {
  const sliced = absPath.slice(root.length + 1).replace(/\\/g, '/')
  const rel = opts?.relPrefix ? `${opts.relPrefix}/${sliced}` : sliced
  if (ignored(sliced)) return null
  const kind = detectKind(rel)
  if (!kind) return null
  const st = await stat(absPath).catch(() => null)
  if (!st) return null
  const fp = await fingerprint(absPath, st.size).catch(() => 'na')
  let meta: { duration?: number; width?: number; height?: number } = {}
  if (kind.type === 'image' && kind.format !== 'PSD') {
    const sharp = (await import('sharp')).default
    const m = await sharp(absPath).metadata().catch(() => null)
    if (m) meta = { width: m.width ?? undefined, height: m.height ?? undefined }
  }
  if (kind.type === 'video') meta = await probeVideo(absPath)
  upsertScanned(
    db,
    libraryId,
    [
      {
        relPath: rel,
        name: rel.slice(rel.lastIndexOf('/') + 1, rel.lastIndexOf('.')),
        type: kind.type,
        format: kind.format,
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
        fingerprint: fp,
        width: meta.width,
        height: meta.height,
        duration: meta.duration
      }
    ],
    opts?.sourceIndexId
  )
  const row = db.prepare('SELECT id FROM assets WHERE rel_path = ?').get(rel) as { id: number } | undefined
  return row?.id ?? null
}

/** 绑定目录增量监听(库根或索引根);返回关闭函数 */
export function watchLibrary(
  db: Database,
  libraryId: number,
  root: string,
  cb: WatchCallbacks,
  opts?: WatchOptions
): FSWatcher {
  const watcher = chokidarWatch(root, {
    ignoreInitial: true,
    usePolling: process.platform === 'win32',
    interval: process.platform === 'win32' ? 1000 : 100,
    binaryInterval: process.platform === 'win32' ? 1000 : 300,
    ignored: (p: string) => {
      const rel = p.slice(root.length + 1).replace(/\\/g, '/')
      if (!rel || rel.startsWith('..')) return false
      return ignored(rel)
    },
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  })

  const handleAddOrChange = (absPath: string): void =>
    debounced(absPath, () => {
      void upsertOne(db, libraryId, root, absPath, opts).then((id) => {
        const sliced = absPath.slice(root.length + 1).replace(/\\/g, '/')
        const rel = opts?.relPrefix ? `${opts.relPrefix}/${sliced}` : sliced
        const row = db.prepare('SELECT id, missing FROM assets WHERE rel_path = ?').get(rel) as
          | { id: number; missing: number }
          | undefined
        if (row?.missing) setAssetMissing(db, rel, false)
        if (id != null || row) {
          if (opts?.onUpsert) opts.onUpsert(id ?? row?.id ?? null)
          cb.onAdded(id ?? row?.id ?? null)
        }
      })
    })

  watcher
    .on('add', handleAddOrChange)
    .on('change', (p: string) => {
      debounced('c:' + p, () => {
        void upsertOne(db, libraryId, root, p, opts).then(() => cb.onChanged())
      })
    })
    .on('unlink', (p: string) => {
      const sliced = p.slice(root.length + 1).replace(/\\/g, '/')
      const rel = opts?.relPrefix ? `${opts.relPrefix}/${sliced}` : sliced
      debounced('u:' + p, () => {
        if (setAssetMissing(db, rel, true)) cb.onMissing(sliced)
      })
    })
    .on('addDir', (p: string) => {
      if (p !== root) cb.onChanged()
    })
    .on('unlinkDir', (p: string) => {
      if (p !== root) cb.onChanged()
    })

  return watcher
}
