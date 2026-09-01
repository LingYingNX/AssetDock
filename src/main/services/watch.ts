import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { join } from 'node:path'
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

async function upsertOne(db: Database, libraryId: number, root: string, absPath: string): Promise<number | null> {
  const rel = absPath.slice(root.length + 1).replace(/\\/g, '/')
  if (ignored(rel)) return null
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
  upsertScanned(db, libraryId, [
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
  ])
  const row = db.prepare('SELECT id FROM assets WHERE library_id = ? AND rel_path = ?').get(libraryId, rel) as { id: number } | undefined
  return row?.id ?? null
}

/** 绑定库增量监听;返回关闭函数 */
export function watchLibrary(db: Database, libraryId: number, root: string, cb: WatchCallbacks): FSWatcher {
  const watcher = chokidarWatch(root, {
    ignoreInitial: true,
    ignored: (p: string) => {
      const rel = p.slice(root.length + 1).replace(/\\/g, '/')
      if (!rel || rel.startsWith('..')) return false
      return ignored(rel)
    },
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  })

  const handleAddOrChange = (absPath: string): void =>
    debounced(absPath, () => {
      void upsertOne(db, libraryId, root, absPath).then((id) => {
        const rel = absPath.slice(root.length + 1).replace(/\\/g, '/')
        const row = db.prepare('SELECT id FROM assets WHERE library_id = ? AND rel_path = ?').get(libraryId, rel) as { id: number; missing: number } | undefined
        if (row?.missing) setAssetMissing(db, libraryId, rel, false)
        if (id != null || row) cb.onAdded(id ?? row?.id ?? null)
      })
    })

  watcher
    .on('add', handleAddOrChange)
    .on('change', (p: string) => {
      debounced('c:' + p, () => {
        void upsertOne(db, libraryId, root, p).then(() => cb.onChanged())
      })
    })
    .on('unlink', (p: string) => {
      const rel = p.slice(root.length + 1).replace(/\\/g, '/')
      debounced('u:' + p, () => {
        if (setAssetMissing(db, libraryId, rel, true)) cb.onMissing(rel)
      })
    })

  void join // 保持 join 引用(路径拼接在调用方)
  return watcher
}
