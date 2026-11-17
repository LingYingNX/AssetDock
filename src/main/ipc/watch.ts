import { scanLibrary } from '../services/scan'
import type { ScanEntry, ScanUpsertResult } from '../services/store'
import { probeVideo } from '../services/videoMeta'
import { refreshPalettes } from '../services/palette'
import {
  setAssetMissing, getAppState, updateAsset, upsertScanned
} from '../services/store'
import { listFolderOrders } from '../services/store'
import { listLibraryFolders, orderLibraryFolders } from '../services/folders'
import { hasLibDb, migrateLibrary } from '../services/libraryDb'
import { collectOrphanThumbs, pruneMissingThumbs } from '../services/thumbs'
import { collectOrphanDocumentPreviews } from '../services/documentPreview'
import { watchLibrary, type FSWatcher } from '../services/watch'
import { migrateLegacySources } from '../services/legacySourceMigration'
import { send } from '../events'
import { getDb } from '../services/db'
import { absPathFor, libRootOf, releaseScope, scopeFor } from './context'
import { queuePaletteRefresh, queueThumbWarmup } from './thumbs'
import { cacheFolderList, invalidateFolderList } from './folderListCache'

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

/**
 * Windows 上 chokidar 对子目录持有句柄,目录 rename 会被拒绝为 EPERM。
 * 文件操作期间必须暂停整库监听,完成后再按磁盘现状重挂。并发操作按库串行,
 * 否则后一个窗口会先重挂监听,把前一个窗口的 rename 继续挡住。
 */
const watcherGates = new Map<string, Promise<void>>()
export async function withoutRootWatcher<T>(libraryId: number, root: string, run: () => Promise<T>): Promise<T> {
  const key = `${libraryId}:root`
  const previous = watcherGates.get(key) ?? Promise.resolve()
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  watcherGates.set(key, tail)
  await previous
  try {
    const wasWatching = !!watchManager.get(key)
    if (wasWatching) await watchManager.close(key)
    try {
      return await run()
    } finally {
      if (wasWatching) attachRootWatcher(libraryId, root)
    }
  } finally {
    release()
    if (watcherGates.get(key) === tail) watcherGates.delete(key)
  }
}

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
      // 全量事件含目录增删改名:目录树缓存必须一起失效,否则侧边栏显示旧树
      invalidateFolderList(libraryId)
      send('assets:changed', { libraryId })
    }
  }
  return {
    onAdded: (id) => {
      const row = typeof id === 'number'
        ? db().prepare('SELECT fingerprint FROM assets WHERE library_id = ? AND id = ?').get(libraryId, id) as
            | { fingerprint: string }
            | undefined
        : undefined
      if (row?.fingerprint) queueThumbWarmup(libraryId, [row.fingerprint])
      else queueThumbWarmup(libraryId)
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

/** 已排队对账的库:watcher 已覆盖运行期变更,每个库每次启动只需要补一次关闭期间的差异 */
const reconciledLibraries = new Set<number>()
/** 让首屏 folders/assets 请求先落地:对账要全库 stat,抢在前面会让侧边栏空白好几秒 */
const RECONCILE_DELAY_MS = 15000
/** 首屏目录树读盘优先:chokidar 首轮遍历会占满 libuv 线程池,推迟到目录树返回之后再挂 */
const WATCHER_ATTACH_DELAY_MS = 5000

/** 启动对账：静默重扫资源库根目录，幂等更新新增与缺失素材。 */
async function reconcileRoot(libraryId: number, root: string): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  try {
    // 对账只需要发现新增/变化/缺失;未变文件只 stat,不再逐个读 64KB 算指纹、跑 sharp 探测。
    // 否则每次启动都是全库重扫,在机械盘上会把首屏数据请求拖到几十秒。
    const knownRows = s.db
      .prepare('SELECT id, rel_path, size_bytes, mtime_ms, fingerprint FROM assets WHERE library_id = ? AND missing = 0')
      .all(libraryId) as { id: number; rel_path: string; size_bytes: number; mtime_ms: number; fingerprint: string }[]
    const known = new Map(knownRows.map((row) => [
      row.rel_path,
      { sizeBytes: row.size_bytes, mtimeMs: row.mtime_ms, fingerprint: row.fingerprint }
    ]))
    const entries = await scanLibrary(root, undefined, undefined, undefined, known)
    let changed = 0
    const changedIds: number[] = []
    if (entries.length > 0) {
      const results = upsertScanned(s.db, libraryId, entries)
      queuePaletteRefresh(s, libraryId, entries, results)
      for (const result of results) {
        if (result.action === 'unchanged') continue
        changed++
        changedIds.push(result.assetId)
      }
    }
    const onDisk = new Set(entries.map((entry) => entry.relPath))
    for (const k of knownRows) {
      if (onDisk.has(k.rel_path)) continue
      if (setAssetMissing(s.db, libraryId, k.rel_path, true)) {
        changed++
        changedIds.push(k.id)
      }
    }
    if (changed > 0) {
      queueThumbWarmup(libraryId)
      invalidateFolderList(libraryId)
      // 带上 id 走增量合并:全量重拉 4 万行会让用户在看素材时白卡一秒。
      // 变化面很大时(首次扫描/整库搬迁)一次拉几千行不如整表重发,仍退回全量。
      if (changedIds.length > 500) send('assets:changed', { libraryId })
      else send('assets:changed', { libraryId, assetIds: changedIds })
    }
    // 对账会补上监听空档期的目录变化:缓存一律作废,下次读树重新遍历
    invalidateFolderList(libraryId)
  } catch {
    /* 对账失败不阻塞启动 */
  } finally {
    releaseScope(s)
  }
}

export function reconcileWhenOpened(libraryId: number): void {
  if (!autoSyncEnabled() || reconciledLibraries.has(libraryId)) return
  const root = libRootOf(libraryId)
  if (!root) return
  reconciledLibraries.add(libraryId)
  // 原先每次切换标签页都全库 stat,27k 素材会把文件夹树拖到秒级才出现;
  // 每个库每次启动只补一次关闭期间的差异,并且等首屏读盘完成后再跑。
  const timer = setTimeout(() => {
    void reconcileRoot(libraryId, root)
  }, RECONCILE_DELAY_MS)
  timer.unref?.()
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
  // 首屏的 folders:list 通常比窗口就绪早不了多久,这里先把目录树读好放进缓存,
  // 渲染层第一次要树时直接命中,不必再等一次全盘遍历。
  void (async () => {
    for (const l of libraries) {
      const s = scopeFor(l.id)
      if (!s) continue
      try {
        const physical = await listLibraryFolders(s.libPath)
        cacheFolderList(l.id, orderLibraryFolders(physical, listFolderOrders(s.db, l.id)))
      } catch {
        /* 读失败留给 folders:list 自己报错 */
      } finally {
        releaseScope(s)
      }
    }
  })()
  for (const l of libraries) {
    if (!hasLibDb(l.path)) continue
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
  // chokidar 首次遍历 10 万文件在机械盘上要 17s,和首屏 folders:list 抢磁盘会让目录树空白好几秒。
  // 先让首屏读盘落地,再挂监听;空档期的变更由 reconcile 全量对账补齐。
  const timer = setTimeout(() => {
    for (const l of libraries) {
      attachRootWatcher(l.id, l.path)
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
          await collectOrphanDocumentPreviews(s.libPath, live).catch(() => undefined)
        } finally {
          releaseScope(s)
        }
      })()
      void enrichMissingMeta(l.id)
      queueThumbWarmup(l.id)
      void enrichMissingPalette(l.id)
    }
  }, WATCHER_ATTACH_DELAY_MS)
  timer.unref?.()
}
