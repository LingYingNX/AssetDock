import { ipcMain, dialog, BrowserWindow } from 'electron'
import { join as joinPath } from 'node:path'
import { access } from 'node:fs/promises'
import { getDb, initDb } from './services/db'
import {
  assetById, createLibrary, listLibraries, getLibrary, listAssets, updateAsset, addTag, removeTag,
  upsertScanned, getOpenTabs, saveOpenTabs, getAppState, setAppState, setAssetMissing, setAssetFolder, renameAssetFolder,
  listFolderOrders, renameFolderOrders, replaceFolderOrders,
  type AssetPatch
} from './services/store'
import { scanLibrary } from './services/scan'
import { watchLibrary, type FSWatcher } from './services/watch'
import { moveEagleLibraryAssets, scanEagleLibrary, type EagleScan } from './services/eagle'
import { migrateLegacySources } from './services/legacySourceMigration'
import { probeVideo } from './services/videoMeta'
import { ensureLibraryStorage, getLibHandle, hasLibDb, migrateLibrary } from './services/libraryDb'
import { assertLibraryFolder, createLibraryFolder, listLibraryFolders, moveLibraryAsset, moveLibraryFolder, orderLibraryFolders, renameLibraryFolder } from './services/folders'

const watchers = new Map<string, FSWatcher>()
const migrationFailures: string[] = []
const openingReconciliations = new Map<number, Promise<void>>()

function win(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function send(channel: string, payload: unknown): void {
  win()?.webContents.send(channel, payload)
}

/* ---------- 库作用域解析 ---------- */

function libRootOf(libraryId: number): string | null {
  return getLibrary(getDb(), libraryId)?.path ?? null
}

interface Scope {
  db: ReturnType<typeof getDb>
  libPath: string
}

/** 库的有效 db:库内 .mediahub/library.db;迁移失败/未迁移回退全局 db */
function scopeFor(libraryId: number): Scope | null {
  const lib = getLibrary(getDb(), libraryId)
  if (!lib) return null
  const migrated = hasLibDb(lib.path)
  const db = migrated ? getLibHandle(lib.path) : getDb()
  // 携带副本打开:把复制带来的旧 library_id 重打为当前注册 id(幂等)
  if (migrated) {
    const stray = db.prepare('SELECT 1 FROM assets WHERE library_id <> ? LIMIT 1').get(libraryId)
    if (stray) db.prepare('UPDATE assets SET library_id = ?').run(libraryId)
  }
  return { db, libPath: lib.path }
}

function absPathFor(s: Scope, relPath: string): string {
  return joinPath(s.libPath, relPath)
}

function folderParent(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function moveFolderBlock(paths: readonly string[], source: string, target: string, placement: 'before' | 'after' | 'inside'): string[] {
  const block = paths.filter((path) => path === source || path.startsWith(`${source}/`))
  const rest = paths.filter((path) => !block.includes(path))
  const targetIndex = rest.indexOf(target)
  if (targetIndex < 0) return paths.slice()
  if (placement === 'before') return [...rest.slice(0, targetIndex), ...block, ...rest.slice(targetIndex)]
  let after = targetIndex + 1
  while (after < rest.length && rest[after].startsWith(`${target}/`)) after++
  return [...rest.slice(0, after), ...block, ...rest.slice(after)]
}

async function scanLibraryContents(libraryId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const entries = await scanLibrary(s.libPath, (done) => send('library:scan', { libraryId, done, phase: 'scanning' }))
  upsertScanned(s.db, libraryId, entries)
  send('library:scan', { libraryId, done: entries.length, phase: 'done', added: entries.length })
}

/* ---------- 监听 ---------- */

function attachRootWatcher(libraryId: number, root: string): void {
  const key = `${libraryId}:root`
  if (watchers.has(key)) return
  const s = scopeFor(libraryId)
  if (!s) return
  const w = watchLibrary(
    s.db,
    libraryId,
    root,
    rootCallbacks(libraryId)
  )
  watchers.set(key, w)
}

function rootCallbacks(libraryId: number): {
  onAdded: (id: number | null) => void
  onChanged: () => void
  onMissing: (rel: string) => void
} {
  return {
    onAdded: (id) => {
      send('assets:changed', { libraryId })
    },
    onChanged: () => send('assets:changed', { libraryId }),
    onMissing: () => send('assets:changed', { libraryId })
  }
}

/* ---------- 启动:迁移 + 监听 + 元数据补齐 ---------- */

function autoSyncEnabled(): boolean {
  try {
    const preferences = JSON.parse(getAppState(getDb(), 'preferences') ?? '{}') as { autoSync?: unknown }
    return preferences.autoSync !== false
  } catch {
    return true
  }
}

function reconcileWhenOpened(libraryId: number): void {
  if (!autoSyncEnabled() || openingReconciliations.has(libraryId)) return
  const root = libRootOf(libraryId)
  if (!root) return
  const work = reconcileLibrary(libraryId, root).finally(() => openingReconciliations.delete(libraryId))
  openingReconciliations.set(libraryId, work)
}

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
  migrationFailures.push(...failed)
  for (const l of libraries) {
    if (hasLibDb(l.path)) {
      try {
        const s = scopeFor(l.id)
        if (s) await migrateLegacySources(s.db, l.id, s.libPath)
      } catch {
        migrationFailures.push(l.name)
      }
    }
    attachRootWatcher(l.id, l.path)
    void enrichMissingMeta(l.id)
  }
}

/** 启动对账：静默重扫资源库根目录，幂等更新新增与缺失素材。 */
async function reconcileLibrary(libraryId: number, root: string): Promise<void> {
  await reconcileRoot(libraryId, root)
}

async function reconcileRoot(libraryId: number, root: string): Promise<void> {
  try {
    const s = scopeFor(libraryId)
    if (!s) return
    const entries = await scanLibrary(root)
    if (entries.length > 0) upsertScanned(s.db, libraryId, entries)
    const known = s.db.prepare('SELECT id, rel_path FROM assets WHERE library_id = ? AND missing = 0').all(libraryId) as { id: number; rel_path: string }[]
    const onDisk = new Set(entries.map((entry) => entry.relPath))
    for (const k of known) {
      if (onDisk.has(k.rel_path)) continue
      setAssetMissing(s.db, libraryId, k.rel_path, true)
    }
    send('assets:changed', { libraryId })
  } catch {
    /* 对账失败不阻塞启动 */
  }
}

/** 旧记录补齐:视频缺 codec/fps 的行重探一次 */
async function enrichMissingMeta(libraryId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const rows = s.db
    .prepare(
      `SELECT id, rel_path FROM assets
       WHERE library_id = ? AND missing = 0 AND deleted_at IS NULL AND type = 'video' AND codec IS NULL`
    )
    .all(libraryId) as { id: number; rel_path: string }[]
  if (rows.length === 0) return
  await Promise.all(rows.map(async (r) => {
    const m = await probeVideo(absPathFor(s, r.rel_path))
    updateAsset(s.db, r.id, { codec: m.codec ?? null, fps: m.fps ?? null, width: m.width, height: m.height, duration: m.duration })
  }))
  send('assets:changed', { libraryId })
}

/* ---------- 注册 ---------- */

export function registerIpc(userData: string): void {
  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win()!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('library:open', (_e, libraryId: number) => {
    if (!libRootOf(libraryId)) return { ok: false }
    reconcileWhenOpened(libraryId)
    return { ok: true }
  })

  ipcMain.handle('library:create', (_e, folderPath: string, requestedName?: string) => {
    if (typeof folderPath !== 'string' || !folderPath.trim()) return { error: '请选择素材库目录' }
    const db = getDb()
    const bound = listLibraries(db).find((l) => l.path.toLowerCase() === folderPath.toLowerCase())
    if (bound) return bound // 已绑定:直接当重开处理
    const name = typeof requestedName === 'string' && requestedName.trim()
      ? requestedName.trim()
      : folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? folderPath
    const lib = createLibrary(db, name, folderPath)
    if ('error' in lib) return lib
    const storageReady = ensureLibraryStorage(db, lib)
    attachRootWatcher(lib.id, folderPath)
    void scanLibraryContents(lib.id)
    return storageReady ? lib : { ...lib, warning: '素材库无法创建本地数据库，当前会话将使用全局回退数据' }
  })

  ipcMain.handle('library:list', () => listLibraries(getDb()))
  ipcMain.handle('library:takeMigrationFailures', () => ({ names: migrationFailures.splice(0) }))

  ipcMain.handle('folders:list', async (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      const physical = await listLibraryFolders(s.libPath)
      return { paths: orderLibraryFolders(physical, listFolderOrders(s.db, libraryId)) }
    } catch {
      return { error: '无法读取素材库文件夹' }
    }
  })

  ipcMain.handle('folders:create', async (_e, libraryId: number) => {
    const root = libRootOf(libraryId)
    const s = scopeFor(libraryId)
    if (!root || !s) return { error: '素材库不存在' }
    try {
      const path = await createLibraryFolder(root)
      const ordered = orderLibraryFolders(await listLibraryFolders(root), listFolderOrders(s.db, libraryId))
      replaceFolderOrders(s.db, libraryId, [path, ...ordered.filter((item) => item !== path)])
      send('assets:changed', { libraryId })
      return { path }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '新建文件夹失败' }
    }
  })

  ipcMain.handle('folders:rename', async (_e, libraryId: number, relPath: string, name: string) => {
    const root = libRootOf(libraryId)
    const s = scopeFor(libraryId)
    if (!root || !s) return { error: '素材库不存在' }
    let path: string | null = null
    try {
      path = await renameLibraryFolder(root, relPath, name)
      renameAssetFolder(s.db, libraryId, relPath, path)
      renameFolderOrders(s.db, libraryId, relPath, path)
      send('assets:changed', { libraryId })
      return { path }
    } catch (error) {
      if (path) {
        const oldName = relPath.split('/').pop()
        try {
          if (oldName) await renameLibraryFolder(root, path, oldName)
        } catch {
          return { error: '重命名后的数据库同步失败，且无法自动恢复目录名称' }
        }
      }
      return { error: error instanceof Error ? error.message : '重命名文件夹失败' }
    }
  })

  ipcMain.handle('folders:move', async (
    _e,
    libraryId: number,
    sourcePath: string,
    targetPath: string,
    placement: 'before' | 'after' | 'inside'
  ) => {
    const root = libRootOf(libraryId)
    const s = scopeFor(libraryId)
    if (!root || !s) return { error: '素材库不存在' }
    if (!['before', 'after', 'inside'].includes(placement) || typeof sourcePath !== 'string') return { error: '文件夹移动参数无效' }
    try {
      const physical = await listLibraryFolders(root)
      if (!physical.includes(sourcePath)) return { error: '只能调整资源库中的本地文件夹' }
      if (!physical.includes(targetPath)) return { error: '目标文件夹不存在' }
      const destinationParent = placement === 'inside' ? targetPath : folderParent(targetPath)
      if (destinationParent === sourcePath || destinationParent.startsWith(`${sourcePath}/`)) return { error: '不能移动到自身或子文件夹' }

      let path = sourcePath
      if (folderParent(sourcePath) !== destinationParent) {
        path = await moveLibraryFolder(root, sourcePath, destinationParent)
        renameAssetFolder(s.db, libraryId, sourcePath, path)
        renameFolderOrders(s.db, libraryId, sourcePath, path)
      }
      const ordered = moveFolderBlock(
        orderLibraryFolders(await listLibraryFolders(root), listFolderOrders(s.db, libraryId)),
        path,
        targetPath,
        placement
      )
      replaceFolderOrders(s.db, libraryId, ordered)
      send('assets:changed', { libraryId })
      return { path }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '移动文件夹失败' }
    }
  })

  ipcMain.handle('assets:list', (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: 'library not found' }
    const lib = getLibrary(getDb(), libraryId)!
    const rows = listAssets(s.db, libraryId).map((r) => ({
      ...r,
      absPath: absPathFor(s, r.rel_path)
    }))
    return {
      library: { id: lib.id, name: lib.name, path: lib.path },
      assets: rows
    }
  })

  ipcMain.handle('assets:update', async (_e, libraryId: number, id: number, patch: AssetPatch) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    updateAsset(s.db, id, patch)
    return { ok: true }
  })

  ipcMain.handle('assets:move', async (_e, libraryId: number, assetIds: number[], targetFolder: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    if (!Array.isArray(assetIds) || assetIds.length === 0) return { error: '没有选择素材' }
    try {
      await assertLibraryFolder(s.libPath, targetFolder)
    } catch (error) {
      return { error: error instanceof Error ? error.message : '目标文件夹不存在' }
    }

    let moved = 0
    for (const assetId of assetIds) {
      if (!Number.isInteger(assetId)) return { error: '素材 ID 无效' }
      const row = s.db.prepare('SELECT rel_path, missing FROM assets WHERE id = ? AND library_id = ?').get(assetId, libraryId) as
        | { rel_path: string; missing: number }
        | undefined
      if (!row) return { error: '素材不存在' }
      if (row.missing) return { error: '缺失文件不能移动' }
      try {
        const relPath = await moveLibraryAsset(s.libPath, row.rel_path, targetFolder)
        s.db.prepare('UPDATE assets SET rel_path = ? WHERE id = ? AND library_id = ?').run(relPath, assetId, libraryId)
        setAssetFolder(s.db, assetId, null)
        moved++
      } catch (error) {
        return { error: error instanceof Error ? error.message : '移动素材失败', moved }
      }
    }

    send('assets:changed', { libraryId })
    return { moved }
  })

  /* 迁移残留清理:仅全局兜底库的素材/标签/关联;注册表与设置保留 */
  ipcMain.handle('library:legacyStats', () => {
    const d = getDb()
    const r = d.prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }
    return { assets: r.c }
  })

  ipcMain.handle('library:purgeLegacy', () => {
    const d = getDb()
    d.transaction(() => {
      d.prepare('DELETE FROM asset_tags').run()
      d.prepare('DELETE FROM tags').run()
      d.prepare('DELETE FROM assets').run()
    })()
    d.pragma('wal_checkpoint(TRUNCATE)')
    return { ok: true }
  })

  ipcMain.handle('assets:addTag', async (_e, libraryId: number, id: number, name: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    addTag(s.db, id, name)
    return { ok: true }
  })

  ipcMain.handle('assets:removeTag', async (_e, libraryId: number, id: number, name: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    removeTag(s.db, id, name)
    return { ok: true }
  })

  ipcMain.handle('assets:emptyTrash', async (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    const purged = s.db.prepare('DELETE FROM assets WHERE library_id = ? AND deleted_at IS NOT NULL').run(libraryId).changes
    return { ok: true, purged }
  })

  /* 清理缺失记录:missing=1 且文件确实不存在(二重校验),不动任何磁盘文件 */
  ipcMain.handle('assets:purgeMissing', async (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { purged: 0 }
    const rows = s.db.prepare('SELECT id, rel_path FROM assets WHERE library_id = ? AND missing = 1').all(libraryId) as { id: number; rel_path: string }[]
    let purged = 0
    for (const r of rows) {
      const gone = await access(absPathFor(s, r.rel_path)).then(() => false, () => true)
      if (gone) {
        s.db.prepare('DELETE FROM assets WHERE id = ?').run(r.id)
        purged++
      }
    }
    return { purged }
  })

  ipcMain.handle('eagle:import', async (_e, libraryId: number, folderPath: string) => {
    const lib = getLibrary(getDb(), libraryId)
    if (!lib) return { error: '当前没有激活的库' }
    if (!hasLibDb(lib.path) && !ensureLibraryStorage(getDb(), lib)) return { error: '素材库无法创建本地数据库' }
    const s = scopeFor(libraryId)
    if (!s || typeof folderPath !== 'string' || !folderPath.trim()) return { error: '请选择 Eagle 素材库目录' }
    let eagle: EagleScan
    try {
      eagle = await scanEagleLibrary(folderPath, (done) => send('library:scan', { libraryId, done, phase: 'scanning' }))
    } catch (error) {
      return { error: error instanceof Error ? error.message : '无法读取 Eagle 素材库' }
    }
    const rootKey = `${libraryId}:root`
    await watchers.get(rootKey)?.close().catch(() => undefined)
    watchers.delete(rootKey)

    try {
      const imported = await moveEagleLibraryAssets(folderPath, s.libPath, eagle, (done) => {
        send('library:scan', { libraryId, done, phase: 'moving' })
      })
      upsertScanned(s.db, libraryId, imported.entries)
      send('library:scan', { libraryId, done: imported.imported, phase: 'done', added: imported.imported })
      send('assets:changed', { libraryId })
      return { imported: imported.imported, multiFolderAssets: imported.multiFolderAssets }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '无法导入 Eagle 素材' }
    } finally {
      attachRootWatcher(libraryId, s.libPath)
    }
  })

  ipcMain.handle('tabs:get', () => getOpenTabs(getDb()))
  ipcMain.handle('tabs:save', (_e, ids: number[]) => {
    saveOpenTabs(getDb(), ids)
    return { ok: true }
  })

  ipcMain.handle('state:get', (_e, key: string) => getAppState(getDb(), key))
  ipcMain.handle('state:set', (_e, key: string, value: string) => {
    setAppState(getDb(), key, value)
    return { ok: true }
  })

}

export function initServices(userData: string): void {
  initDb(userData)
}
