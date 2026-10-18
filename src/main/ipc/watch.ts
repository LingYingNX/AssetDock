import { scanLibrary } from '../services/scan'
import type { ScanEntry, ScanUpsertResult } from '../services/store'
import { probeVideo } from '../services/videoMeta'
import { refreshPalettes } from '../services/palette'
import {
  setAssetMissing, getAppState, updateAsset, upsertScanned
} from '../services/store'
import { hasLibDb, migrateLibrary } from '../services/libraryDb'
import { collectOrphanThumbs, pruneMissingThumbs } from '../services/thumbs'
import { watchLibrary, type FSWatcher } from '../services/watch'
import { migrateLegacySources } from '../services/legacySourceMigration'
import { send } from '../events'
import { getDb } from '../services/db'
import { absPathFor, libRootOf, releaseScope, scopeFor } from './context'
import { queuePaletteRefresh, queueThumbWarmup } from './thumbs'

/* ---------- WatchManager:watcher 生命周期显式收敛(S1-1) ---------- */

class WatchManager {
  private watchers = new Map<string, FSWatcher>()

  get(key: string): FSWatcher | undefined {
    return this.watchers.get(key)
  }

  set(key: string, w: FSWatcher): void {
    this.watchers.set(key, w)
  }

  async close(key: string): Promise<void> {
    const w = this.watchers.get(key)
    if (!w) return
    this.watchers.delete(key)
    await w.close().catch(() => undefined)
  }
}

export const watchManager = new WatchManager()

/** 启动/迁移失败清单,渲染层经 library:takeMigrationFailures 取走;S3-8 环形缓冲 100 条防无界增长 */
const MIGRATION_FAILURES_MAX = 100
export const migrationFailures: string[] = []
function recordMigrationFailure(name: string): void {
  migrationFailures.push(name)
  if (migrationFailures.length > MIGRATION_FAILURES_MAX) migrationFailures.splice(0, migrationFailures.length - MIGRATION_FAILURES_MAX)
}

function rootCallbacks(libraryId: number, db: () => import('better-sqlite3').Database): {
  onAdded: (id: number | null) => void
  onChanged: (assetId: number | null) => void
  onMissing: (rel: string) => void
} {
  // S1-7:watcher 事件尽量携带资产 id 走增量;查不到 id(刚删除/未知)退全量
  const delta = (assetId: number | null | undefined): void => {
    if (typeof assetId === 'number' && assetId > 0) {
      send('assets:changed', { libraryId, assetIds: [assetId] })
    } else {
      send('assets:changed', { libraryId })
    }
  }
  return {
    onAdded: (id) => {
      queueThumbWarmup(libraryId)
      delta(id)
    },
    onChanged: (id) => delta(id),
    onMissing: (rel) => {
      const row = db().prepare('SELECT id FROM assets WHERE library_id = ? AND rel_path = ?').get(libraryId, rel) as
        | { id: number }
        | undefined
      if (row) {
        send('assets:changed', { libraryId, assetIds: [row.id] })
      } else {
        send('assets:changed', { libraryId })
      }
    }
  }
}

export function attachRootWatcher(libraryId: number, root: string): void {
  const key = `${libraryId}:root`
  if (watchManager.get(key)) return
  const s = scopeFor(libraryId)
  if (!s) return
  // watcher 长期持有库 db 回调,占用计数不释放:该库句柄在应用生命周期内常驻,
  // 引用计数保证它不被 LRU 驱逐(误关会击穿后续文件事件回调)
  const w = watchLibrary(
    s.db,
    libraryId,
    root,
    rootCallbacks(libraryId, () => s.db)
  )
  watchManager.set(key, w)
}

export async function scanLibraryContents(libraryId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  try {
    const results: ScanUpsertResult[] = []
    const entries = await scanLibrary(
      s.libPath,
      (done) => send('library:scan', { libraryId, done, phase: 'scanning' }),
      (rel, error) => {
        console.error('[scan] read failed', rel, error)
      },
      (batch) => {
        const batchResults = upsertScanned(s.db, libraryId, batch)
        results.push(...batchResults)
        const changed = batchResults
          .filter((result) => result.action !== 'unchanged')
          .map((result) => result.assetId)
        if (changed.length > 0) send('assets:changed', { libraryId, assetIds: changed })
      }
    )
    const scanErrors = (entries as ScanEntry[] & { __errors?: number }).__errors ?? 0
    const added = results.filter((result) => result.action === 'added').length
    send('library:scan', { libraryId, done: entries.length, phase: 'done', added, ...(scanErrors > 0 ? { errors: scanErrors } : {}) })
    queuePaletteRefresh(s, libraryId, entries, results)
  } finally {
    releaseScope(s)
  }
  queueThumbWarmup(libraryId)
}

function autoSyncEnabled(): boolean {
  try {
    const preferences = JSON.parse(getAppState(getDb(), 'preferences') ?? '{}') as { autoSync?: unknown }
    return preferences.autoSync !== false
  } catch {
    return true
  }
}

const openingReconciliations = new Map<number, Promise<void>>()

/** 启动对账：静默重扫资源库根目录，幂等更新新增与缺失素材。 */
async function reconcileRoot(libraryId: number, root: string): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  try {
    const entries = await scanLibrary(root)
    if (entries.length > 0) {
      const results = upsertScanned(s.db, libraryId, entries)
      queuePaletteRefresh(s, libraryId, entries, results)
      queueThumbWarmup(libraryId)
    }
    const known = s.db.prepare('SELECT id, rel_path FROM assets WHERE library_id = ? AND missing = 0').all(libraryId) as { id: number; rel_path: string }[]
    const onDisk = new Set(entries.map((entry) => entry.relPath))
    for (const k of known) {
      if (onDisk.has(k.rel_path)) continue
      setAssetMissing(s.db, libraryId, k.rel_path, true)
    }
    send('assets:changed', { libraryId })
  } catch {
    /* 对账失败不阻塞启动 */
  } finally {
    releaseScope(s)
  }
}

export function reconcileWhenOpened(libraryId: number): void {
  if (!autoSyncEnabled() || openingReconciliations.has(libraryId)) return
  const root = libRootOf(libraryId)
  if (!root) return
  const work = reconcileRoot(libraryId, root).finally(() => openingReconciliations.delete(libraryId))
  openingReconciliations.set(libraryId, work)
}

/** 旧记录补齐:视频缺 codec/fps 的行重探一次(并发池限流,防止大库一次性 spawn 大量 ffprobe) */
async function enrichMissingMeta(libraryId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  try {
    const rows = s.db
      .prepare(
        `SELECT id, rel_path FROM assets
         WHERE library_id = ? AND missing = 0 AND deleted_at IS NULL AND type = 'video' AND codec IS NULL`
      )
      .all(libraryId) as { id: number; rel_path: string }[]
    if (rows.length === 0) return
    // 有界并发:每批 PROBE_CONCURRENCY 个,全批完成再取下一批(探针是子进程,过并发只会挤爆 IO)
    const PROBE_CONCURRENCY = 4
    for (let i = 0; i < rows.length; i += PROBE_CONCURRENCY) {
      await Promise.all(rows.slice(i, i + PROBE_CONCURRENCY).map(async (r) => {
        const m = await probeVideo(absPathFor(s, r.rel_path))
        updateAsset(s.db, libraryId, r.id, { codec: m.codec ?? null, fps: m.fps ?? null, width: m.width, height: m.height, duration: m.duration })
      }))
    }
    send('assets:changed', { libraryId })
  } finally {
    releaseScope(s)
  }
}

/** 主色补齐:历史图片 palette 为空的行按原文件补抽一次(串行后台,不阻塞启动) */
async function enrichMissingPalette(libraryId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  try {
    const count = await refreshPalettes(s.db, libraryId, s.libPath, {
      onProgress: (done) => { if (done % 50 === 0) send('assets:changed', { libraryId }) }
    })
    if (count > 0) send('assets:changed', { libraryId })
  } finally {
    releaseScope(s)
  }
}

/**
 * 应用启动入口:逐库迁移 → 一次性数据修正 → watcher/预热/补齐。
 * library:migrate 类的启动副作用全部收敛在这里,scopeFor 已退化为纯查表(S1-2)。
 */
export async function attachWatchersFor(libraries: { id: number; path: string; name: string }[]): Promise<void> {
  const global = getDb()
  const failed: string[] = []
  for (const l of libraries) {
    try {
      migrateLibrary(global, l)
    } catch {
      failed.push(l.name) // 回退全局库继续使用
    }
  }
  migrationFailures.push(...failed.slice(0, Math.max(0, MIGRATION_FAILURES_MAX - migrationFailures.length)))
  for (const l of libraries) {
    if (hasLibDb(l.path)) {
      let s: ReturnType<typeof scopeFor> = null
      try {
        s = scopeFor(l.id)
        if (s) {
          // 启动时执行一次:携带副本打开时把复制带来的旧 library_id 重打为当前注册 id(幂等)。
          // 原先嵌在 scopeFor 里每次 handler 调用都跑,剥离到启动路径(S1-2)。
          const stray = s.db.prepare('SELECT 1 FROM assets WHERE library_id <> ? LIMIT 1').get(l.id)
          if (stray) s.db.prepare('UPDATE assets SET library_id = ?').run(l.id)
          await migrateLegacySources(s.db, l.id, s.libPath)
        }
      } catch {
        recordMigrationFailure(l.name)
      } finally {
        if (s) releaseScope(s)
      }
    }
    // 缩略图对账:剔除清单里的失效条目、清理不再被引用的残留文件(含旧尺寸)
    void (async () => {
      const s = scopeFor(l.id)
      if (!s) return
      try {
        await pruneMissingThumbs(s.libPath).catch(() => undefined)
        const live = new Set(
          (s.db.prepare('SELECT fingerprint FROM assets WHERE library_id = ? AND deleted_at IS NULL').all(l.id) as { fingerprint: string }[])
            .map((row) => row.fingerprint)
        )
        await collectOrphanThumbs(s.libPath, live).catch(() => undefined)
      } finally {
        releaseScope(s)
      }
    })()
    attachRootWatcher(l.id, l.path)
    void enrichMissingMeta(l.id)
    queueThumbWarmup(l.id)
    void enrichMissingPalette(l.id)
  }
}
