import { ipcMain, dialog, BrowserWindow } from 'electron'
import { join as joinPath } from 'node:path'
import { access, rm } from 'node:fs/promises'
import { getDb, initDb } from './services/db'
import {
  assetById, createLibrary, listLibraries, getLibrary, listAssets, updateAsset, addTag, removeTag,
  upsertScanned, getOpenTabs, saveOpenTabs, getAppState, setAppState, setAssetMissing, setAssetFolder, renameAssetFolder,
  type AssetPatch, type ScanEntry, type ScanUpsertResult
} from './services/store'
import { scanLibrary } from './services/scan'
import { watchLibrary, type FSWatcher } from './services/watch'
import { ensureThumb, hasThumbIn, thumbPathIn, initThumbs } from './services/thumbs'
import { fileExists } from './services/cacheFiles'
import { indexCachePaths, moveIndexCachePair, removeIndexCachePair, removeIndexSourceCache, removeLegacyIndexSourceCache, writeIndexShortcut, writeIndexSidecar } from './services/indexCache'
import { extractPaletteFromThumb } from './services/palette'
import { probeVideo } from './services/videoMeta'
import { ensureLibraryStorage, getLibHandle, hasLibDb, migrateLibrary } from './services/libraryDb'
import { canonicalIndexRelPath, listIndexes, normalizeIndexedPaths, sourceRelativePath, type IndexRow } from './services/libResolve'
import { assertLibraryFolder, createLibraryFolder, listLibraryFolders, moveLibraryAsset, renameLibraryFolder } from './services/folders'

let userDataDir = '.'
const watchers = new Map<string, FSWatcher>()
const migrationFailures: string[] = []
let indexedSidecarQueue = Promise.resolve()

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

function fallbackThumbs(): string {
  return joinPath(userDataDir, 'thumbs')
}

/** 库的缩略图目录:已迁移走库内 .mediahub/thumbs,未迁移走全局(回退) */
function thumbsDirOf(libraryId: number): string {
  const root = libRootOf(libraryId)
  if (root && hasLibDb(root)) return joinPath(root, '.mediahub', 'thumbs')
  return fallbackThumbs()
}

interface Scope {
  db: ReturnType<typeof getDb>
  libPath: string
  indexes: IndexRow[]
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
  const indexes: IndexRow[] = migrated ? listIndexes(lib.path) : []
  if (migrated) normalizeIndexedPaths(db, libraryId, indexes)
  return { db, libPath: lib.path, indexes }
}

function absPathFor(s: Scope, relPath: string, sourceIndexId: number | null): string {
  if (sourceIndexId != null) {
    const idx = s.indexes.find((item) => item.id === sourceIndexId)
    const sourceRel = sourceRelativePath(relPath, sourceIndexId)
    if (idx && sourceRel != null) return joinPath(idx.path, sourceRel)
    return ''
  }
  return joinPath(s.libPath, relPath)
}

/* ---------- 缩略图/调色板管线 ---------- */

async function ensureThumbAndPalette(
  libraryId: number,
  assetId: number,
  absPath: string,
  type: 'image' | 'video' | 'model',
  format: string,
  fingerprint: string
): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const dir = thumbsDirOf(libraryId)
  const r = await ensureThumb({ fingerprint, absPath, type, format, dir }).catch(() => null)
  if (!r) return
  send('thumbs:ready', { fingerprint })
  if (type === 'image' && !r.placeholder) {
    const palette = await extractPaletteFromThumb(r.path).catch(() => [])
    if (palette.length > 0) {
      updateAsset(s.db, assetId, { palette: JSON.stringify(palette) })
      send('thumbs:ready', { fingerprint })
    }
  }
}

async function syncIndexedSidecar(libraryId: number, assetId: number, updateShortcut = true): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const asset = assetById(s.db, libraryId, assetId)
  if (!asset || asset.source_index_id == null || asset.missing) return
  const sourceRel = sourceRelativePath(asset.rel_path, asset.source_index_id)
  if (sourceRel == null) return
  const paths = indexCachePaths(s.libPath, asset.source_index_id, sourceRel)
  await writeIndexSidecar(paths.sidecar, asset, sourceRel)
  if (updateShortcut) {
    await writeIndexShortcut(paths.shortcut, absPathFor(s, asset.rel_path, asset.source_index_id))
  }
}

// ponytail: 全局串行队列，避免批量移动并发启动大量 PowerShell；吞吐不足时再按库拆分。
function enqueueIndexedSidecarSync(libraryId: number, assetId: number): void {
  indexedSidecarQueue = indexedSidecarQueue.then(async () => {
    try {
      await syncIndexedSidecar(libraryId, assetId, false)
    } catch (error) {
      send('assets:changed', { libraryId, warning: warningFrom(error) })
    }
  })
}

async function syncIndexedDerivative(libraryId: number, assetId: number, forceThumbnail: boolean): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const asset = assetById(s.db, libraryId, assetId)
  if (!asset || asset.source_index_id == null || asset.missing) return
  const sourceRel = sourceRelativePath(asset.rel_path, asset.source_index_id)
  if (sourceRel == null) return
  const paths = indexCachePaths(s.libPath, asset.source_index_id, sourceRel)
  const thumb = await ensureThumb({
    fingerprint: asset.fingerprint,
    absPath: absPathFor(s, asset.rel_path, asset.source_index_id),
    type: asset.type,
    format: asset.format,
    dir: thumbsDirOf(libraryId),
    force: forceThumbnail
  })
  send('thumbs:ready', { fingerprint: asset.fingerprint })
  if (asset.type === 'image' && !thumb.placeholder) {
    const palette = await extractPaletteFromThumb(thumb.path).catch(() => [])
    if (palette.length > 0) updateAsset(s.db, assetId, { palette: JSON.stringify(palette) })
  }
  await syncIndexedSidecar(libraryId, assetId)
}

async function syncIndexedScanResult(libraryId: number, index: IndexRow, result: ScanUpsertResult): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  if (result.action === 'relocated' && result.previousRelPath) {
    const previousSourceRel = sourceRelativePath(result.previousRelPath, index.id)
    const sourceRel = sourceRelativePath(result.relPath, index.id)
    if (previousSourceRel != null && sourceRel != null) {
      await moveIndexCachePair(
        indexCachePaths(s.libPath, index.id, previousSourceRel),
        indexCachePaths(s.libPath, index.id, sourceRel),
        joinPath(index.path, sourceRel)
      )
    }
  }
  await syncIndexedDerivative(libraryId, result.assetId, result.action === 'changed')
}

function warningFrom(error: unknown): string {
  return error instanceof Error ? error.message : '索引缓存同步失败'
}

async function backfillAsset(libraryId: number, assetId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const row = s.db
    .prepare('SELECT rel_path, type, format, fingerprint, source_index_id FROM assets WHERE id = ?')
    .get(assetId) as { rel_path: string; type: 'image' | 'video' | 'model'; format: string; fingerprint: string; source_index_id: number | null } | undefined
  if (!row) return
  if (row.source_index_id != null) {
    const sourceRel = sourceRelativePath(row.rel_path, row.source_index_id)
    if (sourceRel == null) return
    const paths = indexCachePaths(s.libPath, row.source_index_id, sourceRel)
    if (!(await hasThumbIn(thumbsDirOf(libraryId), row.fingerprint)) || !(await fileExists(paths.shortcut)) || !(await fileExists(paths.sidecar))) {
      await syncIndexedDerivative(libraryId, assetId, false)
    }
    return
  }
  await ensureThumbAndPalette(libraryId, assetId, absPathFor(s, row.rel_path, row.source_index_id), row.type, row.format, row.fingerprint)
}

async function backfillLibrary(libraryId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const rows = s.db
    .prepare('SELECT id, rel_path, type, format, fingerprint, source_index_id FROM assets WHERE library_id = ? AND missing = 0')
    .all(libraryId) as { id: number; rel_path: string; type: 'image' | 'video' | 'model'; format: string; fingerprint: string; source_index_id: number | null }[]
  for (const row of rows) {
    if (row.source_index_id != null) {
      const sourceRel = sourceRelativePath(row.rel_path, row.source_index_id)
      if (sourceRel == null) continue
      const paths = indexCachePaths(s.libPath, row.source_index_id, sourceRel)
      if (!(await hasThumbIn(thumbsDirOf(libraryId), row.fingerprint)) || !(await fileExists(paths.shortcut)) || !(await fileExists(paths.sidecar))) {
        await syncIndexedDerivative(libraryId, row.id, false)
      }
    } else if (!(await hasThumbIn(thumbsDirOf(libraryId), row.fingerprint))) {
      await ensureThumbAndPalette(libraryId, row.id, absPathFor(s, row.rel_path, null), row.type, row.format, row.fingerprint)
    }
  }
  for (const index of s.indexes) await removeLegacyIndexSourceCache(s.libPath, index.id)
}

async function scanAndIndex(libraryId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const entries = await scanLibrary(s.libPath, (done) => send('library:scan', { libraryId, done, phase: 'scanning' }))
  upsertScanned(s.db, libraryId, entries)
  send('library:scan', { libraryId, done: entries.length, phase: 'done', added: entries.length })
  for (const e of entries) {
    const row = s.db
      .prepare('SELECT id, fingerprint FROM assets WHERE library_id = ? AND rel_path = ?')
      .get(libraryId, e.relPath) as { id: number; fingerprint: string } | undefined
    if (!row) continue
    await ensureThumbAndPalette(libraryId, row.id, joinPath(s.libPath, e.relPath), e.type, e.format, row.fingerprint)
  }
}

async function scanIndex(libraryId: number, index: IndexRow): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const entries = await scanLibrary(index.path)
  const results = upsertScanned(s.db, libraryId, entries, index.id)
  send('library:scan', { libraryId, done: entries.length, phase: 'done', added: entries.length })
  for (const result of results) {
    if (result.action === 'unchanged') await backfillAsset(libraryId, result.assetId)
    else await syncIndexedScanResult(libraryId, index, result)
  }
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
    rootCallbacks(libraryId),
    { onUpsert: (result) => backfillAsset(libraryId, result.assetId) }
  )
  watchers.set(key, w)
}

function attachIndexWatcher(libraryId: number, index: IndexRow): void {
  const key = `${libraryId}:idx:${index.id}`
  if (watchers.has(key)) return
  const s = scopeFor(libraryId)
  if (!s) return
  const w = watchLibrary(
    s.db,
    libraryId,
    index.path,
    {
      onAdded: () => send('assets:changed', { libraryId }),
      onChanged: () => send('assets:changed', { libraryId }),
      onMissing: () => send('assets:changed', { libraryId })
    },
    {
      sourceIndexId: index.id,
      onUpsert: (result) => syncIndexedDerivative(libraryId, result.assetId, result.action === 'changed'),
      onIndexedRelocated: async (_assetId, previousSourceRel, sourceRel) => {
        const from = indexCachePaths(s.libPath, index.id, previousSourceRel)
        const to = indexCachePaths(s.libPath, index.id, sourceRel)
        await moveIndexCachePair(from, to, joinPath(index.path, sourceRel))
      },
      onIndexedDeleted: async (assetId, sourceRel) => {
        await removeIndexCachePair(indexCachePaths(s.libPath, index.id, sourceRel))
        const row = s.db.prepare('SELECT fingerprint FROM assets WHERE id = ? AND library_id = ?').get(assetId, libraryId) as { fingerprint: string } | undefined
        if (row) await rm(thumbPathIn(thumbsDirOf(libraryId), row.fingerprint), { force: true })
      }
    }
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
      if (id != null) void backfillAsset(libraryId, id)
      send('assets:changed', { libraryId })
    },
    onChanged: () => send('assets:changed', { libraryId }),
    onMissing: () => send('assets:changed', { libraryId })
  }
}

/* ---------- 启动:迁移 + 监听 + 对账 + 元数据补齐 ---------- */

export function attachWatchersFor(libraries: { id: number; path: string; name: string }[]): void {
  const global = getDb()
  const failed: string[] = []
  for (const l of libraries) {
    try {
      migrateLibrary(global, l, fallbackThumbs())
    } catch {
      failed.push(l.name) // 回退全局库继续使用
    }
  }
  migrationFailures.push(...failed)
  for (const l of libraries) {
    attachRootWatcher(l.id, l.path)
    void reconcileLibrary(l.id, l.path)
  }
  for (const l of libraries) void enrichMissingMeta(l.id)
  for (const l of libraries) {
    if (!hasLibDb(l.path)) continue
    for (const idx of listIndexes(l.path)) attachIndexWatcher(l.id, idx)
  }
}

/** 启动对账:静默重扫库根与全部索引根,幂等 upsert(新文件入库、已删文件标缺失) */
async function reconcileLibrary(libraryId: number, root: string): Promise<void> {
  await reconcileRoot(libraryId, root)
  const s = scopeFor(libraryId)
  if (!s) return
  for (const idx of s.indexes) await reconcileRoot(libraryId, idx.path, idx)
}

async function reconcileRoot(libraryId: number, root: string, index?: IndexRow): Promise<void> {
  try {
    const s = scopeFor(libraryId)
    if (!s) return
    const entries = await scanLibrary(root)
    const results = entries.length > 0 ? upsertScanned(s.db, libraryId, entries, index?.id) : []
    if (index) {
      for (const result of results) {
        if (result.action === 'unchanged') await backfillAsset(libraryId, result.assetId)
        else await syncIndexedScanResult(libraryId, index, result)
      }
    }
    const known = index
      ? s.db.prepare('SELECT id, rel_path, fingerprint FROM assets WHERE library_id = ? AND missing = 0 AND source_index_id = ?').all(libraryId, index.id) as { id: number; rel_path: string; fingerprint: string }[]
      : s.db.prepare('SELECT id, rel_path, fingerprint FROM assets WHERE library_id = ? AND missing = 0 AND source_index_id IS NULL').all(libraryId) as { id: number; rel_path: string; fingerprint: string }[]
    const onDisk = new Set(entries.map((entry) => index ? canonicalIndexRelPath(index.id, entry.relPath) : entry.relPath))
    for (const k of known) {
      if (onDisk.has(k.rel_path)) continue
      if (!index) {
        setAssetMissing(s.db, libraryId, k.rel_path, true)
        continue
      }
      const sourceRel = sourceRelativePath(k.rel_path, index.id)
      if (sourceRel == null) continue
      try {
        await removeIndexCachePair(indexCachePaths(s.libPath, index.id, sourceRel))
        await rm(thumbPathIn(thumbsDirOf(libraryId), k.fingerprint), { force: true })
        s.db.prepare('DELETE FROM assets WHERE id = ? AND library_id = ?').run(k.id, libraryId)
      } catch {
        setAssetMissing(s.db, libraryId, k.rel_path, true)
      }
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
      `SELECT id, rel_path, source_index_id FROM assets
       WHERE library_id = ? AND missing = 0 AND deleted_at IS NULL AND type = 'video' AND codec IS NULL`
    )
    .all(libraryId) as { id: number; rel_path: string; source_index_id: number | null }[]
  if (rows.length === 0) return
  for (const r of rows) {
    const m = await probeVideo(absPathFor(s, r.rel_path, r.source_index_id))
    updateAsset(s.db, r.id, { codec: m.codec ?? null, fps: m.fps ?? null, width: m.width, height: m.height, duration: m.duration })
    if (r.source_index_id != null) await syncIndexedSidecar(libraryId, r.id).catch(() => undefined)
  }
  send('assets:changed', { libraryId })
}

/* ---------- 注册 ---------- */

export function registerIpc(userData: string): void {
  userDataDir = userData
  initThumbs(userData)

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win()!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('library:create', (_e, folderPath: string) => {
    const db = getDb()
    const bound = listLibraries(db).find((l) => l.path.toLowerCase() === folderPath.toLowerCase())
    if (bound) return bound // 已绑定:直接当重开处理
    const name = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? folderPath
    const lib = createLibrary(db, name, folderPath)
    if ('error' in lib) return lib
    const storageReady = ensureLibraryStorage(db, lib, fallbackThumbs())
    attachRootWatcher(lib.id, folderPath)
    void scanAndIndex(lib.id).then(() => backfillLibrary(lib.id))
    return storageReady ? lib : { ...lib, warning: '素材库无法创建本地数据库，当前会话将使用全局回退数据' }
  })

  ipcMain.handle('library:list', () => listLibraries(getDb()))
  ipcMain.handle('library:takeMigrationFailures', () => ({ names: migrationFailures.splice(0) }))

  ipcMain.handle('folders:list', async (_e, libraryId: number) => {
    const root = libRootOf(libraryId)
    if (!root) return { error: '素材库不存在' }
    try {
      return { paths: await listLibraryFolders(root) }
    } catch {
      return { error: '无法读取素材库文件夹' }
    }
  })

  ipcMain.handle('folders:create', async (_e, libraryId: number) => {
    const root = libRootOf(libraryId)
    if (!root) return { error: '素材库不存在' }
    try {
      const path = await createLibraryFolder(root)
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
      const indexed = s.db
        .prepare('SELECT id FROM assets WHERE library_id = ? AND source_index_id IS NOT NULL AND (folder_path = ? OR instr(folder_path, ?) = 1)')
        .all(libraryId, path, `${path}/`) as { id: number }[]
      let warning: string | undefined
      for (const asset of indexed) {
        warning ??= await syncIndexedSidecar(libraryId, asset.id).then(() => undefined, warningFrom)
      }
      send('assets:changed', { libraryId })
      return warning ? { path, warning } : { path }
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

  ipcMain.handle('assets:list', (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: 'library not found' }
    const lib = getLibrary(getDb(), libraryId)!
    const rows = listAssets(s.db, libraryId).map((r) => ({
      ...r,
      absPath: absPathFor(s, r.rel_path, r.source_index_id),
      index_name:
        r.source_index_id != null ? (s.indexes.find((i) => i.id === r.source_index_id)?.name ?? null) : null
    }))
    void backfillLibrary(libraryId)
    return {
      library: { id: lib.id, name: lib.name, path: lib.path },
      indexes: s.indexes,
      assets: rows
    }
  })

  ipcMain.handle('assets:update', async (_e, libraryId: number, id: number, patch: AssetPatch) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    updateAsset(s.db, id, patch)
    const warning = await syncIndexedSidecar(libraryId, id).then(() => undefined, warningFrom)
    if (warning) send('assets:changed', { libraryId, warning })
    return warning ? { ok: true, warning } : { ok: true }
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
      const row = s.db.prepare('SELECT rel_path, missing, source_index_id FROM assets WHERE id = ? AND library_id = ?').get(assetId, libraryId) as
        | { rel_path: string; missing: number; source_index_id: number | null }
        | undefined
      if (!row) return { error: '素材不存在' }
      if (row.missing) return { error: '缺失文件不能移动' }
      try {
        if (row.source_index_id != null) {
          if (!s.indexes.some((item) => item.id === row.source_index_id)) return { error: '索引来源不存在' }
          setAssetFolder(s.db, assetId, targetFolder || null)
          enqueueIndexedSidecarSync(libraryId, assetId)
        } else {
          const relPath = await moveLibraryAsset(s.libPath, row.rel_path, targetFolder)
          s.db.prepare('UPDATE assets SET rel_path = ? WHERE id = ? AND library_id = ?').run(relPath, assetId, libraryId)
          setAssetFolder(s.db, assetId, null)
        }
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
    const warning = await syncIndexedSidecar(libraryId, id).then(() => undefined, warningFrom)
    return warning ? { ok: true, warning } : { ok: true }
  })

  ipcMain.handle('assets:removeTag', async (_e, libraryId: number, id: number, name: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    removeTag(s.db, id, name)
    const warning = await syncIndexedSidecar(libraryId, id).then(() => undefined, warningFrom)
    return warning ? { ok: true, warning } : { ok: true }
  })

  ipcMain.handle('assets:emptyTrash', async (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    const indexed = s.db
      .prepare('SELECT id, rel_path, source_index_id FROM assets WHERE library_id = ? AND deleted_at IS NOT NULL AND source_index_id IS NOT NULL')
      .all(libraryId) as { id: number; rel_path: string; source_index_id: number; fingerprint: string }[]
    let purged = s.db.prepare('DELETE FROM assets WHERE library_id = ? AND deleted_at IS NOT NULL AND source_index_id IS NULL').run(libraryId).changes
    let warning: string | undefined
    for (const asset of indexed) {
      const sourceRel = sourceRelativePath(asset.rel_path, asset.source_index_id)
      if (sourceRel == null) {
        warning ??= '索引素材路径无效，未清理缓存'
        continue
      }
      try {
        await removeIndexCachePair(indexCachePaths(s.libPath, asset.source_index_id, sourceRel))
        await rm(thumbPathIn(thumbsDirOf(libraryId), asset.fingerprint), { force: true })
        purged += s.db.prepare('DELETE FROM assets WHERE id = ? AND library_id = ?').run(asset.id, libraryId).changes
      } catch (error) {
        warning ??= warningFrom(error)
      }
    }
    return warning ? { ok: true, purged, warning } : { ok: true, purged }
  })

  /* 清理缺失记录:missing=1 且文件确实不存在(二重校验),不动任何磁盘文件 */
  ipcMain.handle('assets:purgeMissing', async (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { purged: 0 }
    const rows = s.db.prepare('SELECT id, rel_path, source_index_id, fingerprint FROM assets WHERE library_id = ? AND missing = 1').all(libraryId) as { id: number; rel_path: string; source_index_id: number | null; fingerprint: string }[]
    let purged = 0
    for (const r of rows) {
      const gone = await access(absPathFor(s, r.rel_path, r.source_index_id)).then(() => false, () => true)
      if (gone) {
        if (r.source_index_id != null) {
          const sourceRel = sourceRelativePath(r.rel_path, r.source_index_id)
          if (sourceRel == null) continue
            try {
              await removeIndexCachePair(indexCachePaths(s.libPath, r.source_index_id, sourceRel))
              await rm(thumbPathIn(thumbsDirOf(libraryId), r.fingerprint), { force: true })
            } catch {
            continue
          }
        }
        s.db.prepare('DELETE FROM assets WHERE id = ?').run(r.id)
        purged++
      }
    }
    return { purged }
  })

  /* 索引目录 */
  ipcMain.handle('index:add', async (_e, libraryId: number, folderPath: string) => {
    const db = getDb()
    const lib = getLibrary(db, libraryId)
    if (!lib) return { error: '当前没有激活的库' }
    if (!hasLibDb(lib.path) && !ensureLibraryStorage(db, lib, fallbackThumbs())) {
      return { error: '素材库无法创建本地数据库，暂不能索引目录' }
    }
    const s = scopeFor(libraryId)
    if (!s) return { error: '当前没有激活的库' }
    const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
    const target = norm(folderPath)
    const libRoot = norm(lib.path)
    if (target === libRoot || target.startsWith(libRoot + '\\') || target.startsWith(libRoot + '/')) {
      return { error: '不能索引库自身目录或其子目录' }
    }
    for (const l of listLibraries(db)) {
      const other = norm(l.path)
      if (
        other === target ||
        other.startsWith(target + '\\') || other.startsWith(target + '/') ||
        target.startsWith(other + '\\') || target.startsWith(other + '/')
      ) {
        return { error: `该目录与库目录(${l.name})重叠` }
      }
    }
    for (const idx of s.indexes) {
      const other = norm(idx.path)
      if (other === target) return { error: '该目录已被索引' }
      if (other.startsWith(target + '\\') || target.startsWith(other + '/') || target.startsWith(other + '\\') || other.startsWith(target + '/')) {
        return { error: '与既有索引目录重叠' }
      }
    }
    let realTarget = folderPath
    try {
      realTarget = await (await import('node:fs/promises')).realpath(folderPath)
    } catch { /* 保持原路径 */ }
    const realN = norm(realTarget)
    if (realN === libRoot || realN.startsWith(libRoot + '\\') || realN.startsWith(libRoot + '/')) {
      return { error: '不能索引库自身目录或其子目录' }
    }
    const name = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? folderPath
    const info = s.db.prepare('INSERT INTO index_sources(path, name) VALUES (?, ?)').run(folderPath, name)
    const index: IndexRow = { id: Number(info.lastInsertRowid), path: folderPath, name }
    attachIndexWatcher(libraryId, index)
    void scanIndex(libraryId, index).then(() => backfillLibrary(libraryId))
    return { id: index.id, name: index.name, path: index.path }
  })

  ipcMain.handle('index:remove', async (_e, libraryId: number, indexId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    const idx = s.indexes.find((i) => i.id === indexId)
    if (!idx) return { ok: false }
    const key = `${libraryId}:idx:${indexId}`
    await watchers.get(key)?.close().catch(() => undefined)
    watchers.delete(key)
    const rows = s.db
      .prepare('SELECT id, rel_path, fingerprint FROM assets WHERE library_id = ? AND source_index_id = ?')
      .all(libraryId, indexId) as { id: number; rel_path: string; fingerprint: string }[]
    for (const row of rows) {
      const sourceRel = sourceRelativePath(row.rel_path, indexId)
      if (sourceRel == null) continue
      await removeIndexCachePair(indexCachePaths(s.libPath, indexId, sourceRel))
      await rm(thumbPathIn(thumbsDirOf(libraryId), row.fingerprint), { force: true })
    }
    try {
      await removeIndexSourceCache(s.libPath, indexId)
    } catch (error) {
      return { ok: false, error: warningFrom(error) }
    }
    s.db.prepare('DELETE FROM assets WHERE library_id = ? AND source_index_id = ?').run(libraryId, indexId)
    s.db.prepare('DELETE FROM index_sources WHERE id = ?').run(indexId)
    return { ok: true }
  })

  ipcMain.handle('index:list', (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    return s ? s.indexes : []
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

  ipcMain.handle('thumbs:path', (_e, libraryId: number, fingerprint: string) => {
    return { path: thumbPathIn(thumbsDirOf(libraryId), fingerprint), exists: null }
  })
}

export function initServices(userData: string): void {
  userDataDir = userData
  initDb(userData)
  void userDataDir
}
