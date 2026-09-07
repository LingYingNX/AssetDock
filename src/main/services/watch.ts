import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
export type { FSWatcher }
import { stat } from 'node:fs/promises'
import { isIgnoredWatch, detectKind } from './ignore'
import { fingerprint } from './fingerprint'
import { probeVideo } from './videoMeta'
import { canonicalIndexRelPath } from './libResolve'
import { mergeIndexedRename, upsertScanned, setAssetMissing, type ScanUpsertResult } from './store'
import type { Database } from 'better-sqlite3'

export interface WatchCallbacks {
  onAdded: (assetId: number | null) => void
  onChanged: () => void
  onMissing: (relPath: string) => void
}

export interface WatchOptions {
  /** 索引素材来源标记 */
  sourceIndexId?: number
  /** upsert 后回调(触发缩略图补齐或索引 sidecar 同步) */
  onUpsert?: (result: ScanUpsertResult) => void | Promise<void>
  /** 索引素材重命名或移动后，迁移其派生缓存。 */
  onIndexedRelocated?: (assetId: number, previousSourceRel: string, sourceRel: string) => Promise<void>
  /** 索引素材确认删除后，先删除派生缓存，再删除数据库记录。 */
  onIndexedDeleted?: (assetId: number, sourceRel: string) => Promise<void>
}

const debounces = new Map<string, NodeJS.Timeout>()
const RENAME_WINDOW_MS = 1500

interface RecentIndexedAdd {
  result: ScanUpsertResult
  sourceRel: string
}

export const WATCH_OPTIONS = {
  ignoreInitial: true,
  usePolling: false,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
} as const

function storedRelPath(relPath: string, sourceIndexId?: number): string {
  return sourceIndexId != null ? canonicalIndexRelPath(sourceIndexId, relPath) : relPath
}

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
): Promise<ScanUpsertResult | null> {
  const sliced = absPath.slice(root.length + 1).replace(/\\/g, '/')
  const rel = sliced
  if (ignored(sliced)) return null
  const kind = detectKind(sliced)
  if (!kind) return null
  const st = await stat(absPath).catch(() => null)
  if (!st) return null
  const fp = await fingerprint(absPath, st.size, st.mtimeMs).catch(() => 'na')
  let meta: { duration?: number; width?: number; height?: number } = {}
  if (kind.type === 'image' && kind.format !== 'PSD') {
    const sharp = (await import('sharp')).default
    const m = await sharp(absPath).metadata().catch(() => null)
    if (m) meta = { width: m.width ?? undefined, height: m.height ?? undefined }
  }
  if (kind.type === 'video') meta = await probeVideo(absPath)
  const [result] = upsertScanned(
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
  return result ?? null
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
    ...WATCH_OPTIONS,
    ignored: (p: string) => {
      const rel = p.slice(root.length + 1).replace(/\\/g, '/')
      if (!rel || rel.startsWith('..')) return false
      return ignored(rel)
    }
  })
  const recentAdds = new Map<string, RecentIndexedAdd[]>()
  const recentAddTimers = new Set<NodeJS.Timeout>()
  const deleteTimers = new Map<string, NodeJS.Timeout>()

  const rememberIndexedAdd = (result: ScanUpsertResult, sourceRel: string): void => {
    if (opts?.sourceIndexId == null) return
    const row = db.prepare('SELECT fingerprint FROM assets WHERE id = ? AND library_id = ?').get(result.assetId, libraryId) as
      | { fingerprint: string }
      | undefined
    if (!row) return
    const key = `${opts.sourceIndexId}:${row.fingerprint}`
    const remembered: RecentIndexedAdd = { result, sourceRel }
    const entries = recentAdds.get(key) ?? []
    entries.push(remembered)
    recentAdds.set(key, entries)
    const timer = setTimeout(() => {
      const current = recentAdds.get(key)
      if (current) {
        const remaining = current.filter((entry) => entry !== remembered)
        if (remaining.length > 0) recentAdds.set(key, remaining)
        else recentAdds.delete(key)
      }
      recentAddTimers.delete(timer)
    }, RENAME_WINDOW_MS)
    recentAddTimers.add(timer)
  }

  const emitUpsert = async (result: ScanUpsertResult, sourceRel: string): Promise<void> => {
    if (result.action === 'relocated' && result.previousRelPath && opts?.sourceIndexId != null) {
      const previousSourceRel = result.previousRelPath.slice(canonicalIndexRelPath(opts.sourceIndexId, '').length)
      await opts.onIndexedRelocated?.(result.assetId, previousSourceRel, sourceRel)
    }
    await opts?.onUpsert?.(result)
  }

  const handleAddOrChange = (absPath: string, changed: boolean): void =>
    debounced(absPath, () => {
      void upsertOne(db, libraryId, root, absPath, opts).then(async (result) => {
        const sliced = absPath.slice(root.length + 1).replace(/\\/g, '/')
        const rel = storedRelPath(sliced, opts?.sourceIndexId)
        const row = db.prepare('SELECT id, missing FROM assets WHERE library_id = ? AND rel_path = ?').get(libraryId, rel) as
          | { id: number; missing: number }
          | undefined
        if (row?.missing) setAssetMissing(db, libraryId, rel, false)
        if (result || row) {
          const completed = result ?? { assetId: row!.id, action: 'unchanged' as const, relPath: rel }
          if (!changed) rememberIndexedAdd(completed, sliced)
          await emitUpsert(completed, sliced)
          if (changed) cb.onChanged()
          else cb.onAdded(completed.assetId)
        }
        else if (changed) cb.onChanged()
      }).catch(() => cb.onChanged())
    })

  const handleIndexedUnlink = async (absPath: string, sourceRel: string): Promise<void> => {
    const sourceIndexId = opts?.sourceIndexId
    if (sourceIndexId == null) return
    if (await stat(absPath).then(() => true, () => false)) {
      const restored = await upsertOne(db, libraryId, root, absPath, opts)
      if (restored) await emitUpsert(restored, sourceRel)
      return
    }
    const onIndexedDeleted = opts?.onIndexedDeleted
    const rel = storedRelPath(sourceRel, sourceIndexId)
    const original = db
      .prepare('SELECT id, fingerprint, missing FROM assets WHERE library_id = ? AND source_index_id = ? AND rel_path = ?')
      .get(libraryId, sourceIndexId, rel) as { id: number; fingerprint: string; missing: number } | undefined
    if (!original || original.missing) return
    const addKey = `${sourceIndexId}:${original.fingerprint}`
    const candidates = (recentAdds.get(addKey) ?? []).filter((entry) => entry.sourceRel !== sourceRel)
    if (candidates.length === 1) {
      const recent = candidates[0]
      recentAdds.delete(addKey)
      const assetId = mergeIndexedRename(db, libraryId, sourceIndexId, sourceRel, recent.sourceRel)
      if (assetId != null) {
        await emitUpsert(
          { assetId, action: 'relocated', relPath: storedRelPath(recent.sourceRel, sourceIndexId), previousRelPath: rel },
          recent.sourceRel
        )
        cb.onChanged()
        return
      }
    }
    if (!setAssetMissing(db, libraryId, rel, true)) return
    if (deleteTimers.has(rel)) return
    const timer = setTimeout(() => {
      deleteTimers.delete(rel)
      void (async () => {
        try {
          const current = db
            .prepare('SELECT id, missing FROM assets WHERE library_id = ? AND source_index_id = ? AND rel_path = ?')
            .get(libraryId, sourceIndexId, rel) as { id: number; missing: number } | undefined
          if (!current || !current.missing) return
          await onIndexedDeleted?.(current.id, sourceRel)
          db.prepare('DELETE FROM assets WHERE id = ? AND library_id = ?').run(current.id, libraryId)
          cb.onMissing(sourceRel)
        } catch {
          // 保留 missing 记录，下一次对账或手动清理会重试派生缓存删除。
        }
      })()
    }, RENAME_WINDOW_MS)
    deleteTimers.set(rel, timer)
  }

  watcher
    .on('add', (p: string) => handleAddOrChange(p, false))
    .on('change', (p: string) => handleAddOrChange(p, true))
    .on('unlink', (p: string) => {
      const sliced = p.slice(root.length + 1).replace(/\\/g, '/')
      const rel = storedRelPath(sliced, opts?.sourceIndexId)
      debounced('u:' + p, () => {
        if (opts?.sourceIndexId != null) void handleIndexedUnlink(p, sliced)
        else if (setAssetMissing(db, libraryId, rel, true)) cb.onMissing(sliced)
      })
    })
    .on('addDir', (p: string) => {
      if (p !== root) cb.onChanged()
    })
    .on('unlinkDir', (p: string) => {
      if (p !== root) cb.onChanged()
    })
    .on('close', () => {
      for (const timer of recentAddTimers) clearTimeout(timer)
      for (const timer of deleteTimers.values()) clearTimeout(timer)
      recentAdds.clear()
    })

  return watcher
}
