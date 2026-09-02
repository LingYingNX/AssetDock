import { ipcMain, dialog, BrowserWindow } from 'electron'
import { join as joinPath } from 'node:path'
import { access } from 'node:fs/promises'
import { getDb, initDb } from './services/db'
import {
  createLibrary, listLibraries, getLibrary, listAssets, updateAsset, addTag, removeTag,
  upsertScanned, getOpenTabs, saveOpenTabs, getAppState, setAppState, setAssetMissing,
  type AssetPatch, type ScanEntry
} from './services/store'
import { scanLibrary } from './services/scan'
import { watchLibrary, type FSWatcher } from './services/watch'
import { ensureThumb, hasThumbIn, thumbPathIn, initThumbs } from './services/thumbs'
import { extractPaletteFromThumb } from './services/palette'
import { probeVideo } from './services/videoMeta'
import { getLibHandle, hasLibDb, migrateLibrary } from './services/libraryDb'
import { listIndexes, findByFingerprint, type IndexRow } from './services/libResolve'

let userDataDir = '.'
const watchers = new Map<string, FSWatcher>()

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
  return { db, libPath: lib.path, indexes }
}

function absPathFor(s: Scope, libraryId: number, relPath: string): string {
  const idx = s.indexes.find((i) => relPath.startsWith(i.name + '/'))
  if (idx) return joinPath(idx.path, relPath.slice(idx.name.length + 1))
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

async function backfillAsset(libraryId: number, assetId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const row = s.db
    .prepare('SELECT rel_path, type, format, fingerprint FROM assets WHERE id = ?')
    .get(assetId) as { rel_path: string; type: 'image' | 'video' | 'model'; format: string; fingerprint: string } | undefined
  if (!row) return
  await ensureThumbAndPalette(libraryId, assetId, absPathFor(s, libraryId, row.rel_path), row.type, row.format, row.fingerprint)
}

async function backfillLibrary(libraryId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const dir = thumbsDirOf(libraryId)
  const rows = s.db
    .prepare('SELECT id, rel_path, type, format, fingerprint FROM assets WHERE missing = 0')
    .all() as { id: number; rel_path: string; type: 'image' | 'video' | 'model'; format: string; fingerprint: string }[]
  for (const row of rows) {
    if (!(await hasThumbIn(dir, row.fingerprint))) {
      await ensureThumbAndPalette(libraryId, row.id, absPathFor(s, libraryId, row.rel_path), row.type, row.format, row.fingerprint)
    }
  }
}

async function scanAndIndex(libraryId: number): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const entries = await scanLibrary(s.libPath, (done) => send('library:scan', { libraryId, done, phase: 'scanning' }))
  upsertScanned(s.db, libraryId, entries)
  send('library:scan', { libraryId, done: entries.length, phase: 'done', added: entries.length })
  for (const e of entries) {
    const row = s.db
      .prepare('SELECT id, fingerprint FROM assets WHERE rel_path = ?')
      .get(e.relPath) as { id: number; fingerprint: string } | undefined
    if (!row) continue
    await ensureThumbAndPalette(libraryId, row.id, joinPath(s.libPath, e.relPath), e.type, e.format, row.fingerprint)
  }
}

async function scanIndex(libraryId: number, index: IndexRow): Promise<void> {
  const s = scopeFor(libraryId)
  if (!s) return
  const entries = await scanLibrary(index.path)
  const mapped = entries.map((e) => ({ ...e, relPath: `${index.name}/${e.relPath}` }))
  upsertScanned(s.db, libraryId, mapped, index.id)
  send('library:scan', { libraryId, done: mapped.length, phase: 'done', added: mapped.length })
  for (const e of mapped) {
    const row = s.db
      .prepare('SELECT id, fingerprint FROM assets WHERE rel_path = ? AND source_index_id = ?')
      .get(e.relPath, index.id) as { id: number; fingerprint: string } | undefined
    if (!row) continue
    await ensureThumbAndPalette(libraryId, row.id, joinPath(index.path, e.relPath.slice(index.name.length + 1)), e.type, e.format, row.fingerprint)
  }
}

/* ---------- 监听 ---------- */

function attachRootWatcher(libraryId: number, root: string): void {
  const key = `${libraryId}:root`
  if (watchers.has(key)) return
  const w = watchLibrary(
    getDb(),
    libraryId,
    root,
    rootCallbacks(libraryId),
    { onUpsert: (id: number | null) => {
        if (id != null) void backfillAsset(libraryId, id)
      } }
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
      onMissing: (rel) => {
        setAssetMissing(s.db, `${index.name}/${rel}`, true)
        send('assets:changed', { libraryId })
      }
    },
    { relPrefix: index.name, sourceIndexId: index.id }
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
    onMissing: (rel) => {
      setAssetMissing(getDb(), rel, true)
      send('assets:changed', { libraryId })
    }
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
  if (failed.length > 0) send('migrate:failed', { names: failed })
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
  await reconcileRoot(libraryId, root, '')
  const s = scopeFor(libraryId)
  if (!s) return
  for (const idx of s.indexes) await reconcileRoot(libraryId, idx.path, `${idx.name}/`)
}

async function reconcileRoot(libraryId: number, root: string, prefix: string): Promise<void> {
  try {
    const s = scopeFor(libraryId)
    if (!s) return
    const entries = await scanLibrary(root)
    const mapped = entries.map((e) => (prefix ? { ...e, relPath: `${prefix}${e.relPath}` } : e))
    if (mapped.length > 0) upsertScanned(s.db, libraryId, mapped)
    const known = s.db.prepare('SELECT rel_path FROM assets WHERE missing = 0').all() as { rel_path: string }[]
    const onDisk = new Set(mapped.map((e) => e.relPath))
    for (const k of known) {
      if (!k.rel_path.startsWith(prefix)) continue
      if (!onDisk.has(k.rel_path)) setAssetMissing(s.db, k.rel_path, true)
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
       WHERE missing = 0 AND deleted_at IS NULL AND type = 'video' AND codec IS NULL`
    )
    .all() as { id: number; rel_path: string }[]
  if (rows.length === 0) return
  for (const r of rows) {
    const m = await probeVideo(absPathFor(s, libraryId, r.rel_path))
    updateAsset(s.db, r.id, { codec: m.codec ?? null, fps: m.fps ?? null, width: m.width, height: m.height, duration: m.duration })
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
    attachRootWatcher(lib.id, folderPath)
    void scanAndIndex(lib.id).then(() => backfillLibrary(lib.id))
    return lib
  })

  ipcMain.handle('library:list', () => listLibraries(getDb()))

  ipcMain.handle('assets:list', (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: 'library not found' }
    const lib = getLibrary(getDb(), libraryId)!
    const rows = listAssets(s.db, libraryId).map((r) => ({
      ...r,
      absPath: absPathFor(s, libraryId, r.rel_path),
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

  ipcMain.handle('assets:update', (_e, libraryId: number, id: number, patch: AssetPatch) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    updateAsset(s.db, id, patch)
    return { ok: true }
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

  ipcMain.handle('assets:addTag', (_e, libraryId: number, id: number, name: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    addTag(s.db, id, name)
    return { ok: true }
  })

  ipcMain.handle('assets:removeTag', (_e, libraryId: number, id: number, name: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    removeTag(s.db, id, name)
    return { ok: true }
  })

  ipcMain.handle('assets:emptyTrash', (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    s.db.prepare('DELETE FROM assets WHERE deleted_at IS NOT NULL').run()
    return { ok: true }
  })

  /* 清理缺失记录:missing=1 且文件确实不存在(二重校验),不动任何磁盘文件 */
  ipcMain.handle('assets:purgeMissing', async (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { purged: 0 }
    const rows = s.db.prepare('SELECT id, rel_path FROM assets WHERE missing = 1').all() as { id: number; rel_path: string }[]
    let purged = 0
    for (const r of rows) {
      const gone = await access(absPathFor(s, libraryId, r.rel_path)).then(() => false, () => true)
      if (gone) {
        s.db.prepare('DELETE FROM assets WHERE id = ?').run(r.id)
        purged++
      }
    }
    return { purged }
  })

  /* 索引目录 */
  ipcMain.handle('index:add', async (_e, libraryId: number, folderPath: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '当前没有激活的库' }
    const db = getDb()
    const lib = getLibrary(db, libraryId)!
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

  ipcMain.handle('index:remove', (_e, libraryId: number, indexId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    const idx = s.indexes.find((i) => i.id === indexId)
    if (!idx) return { ok: false }
    s.db.prepare('DELETE FROM assets WHERE source_index_id = ?').run(indexId)
    s.db.prepare('DELETE FROM index_sources WHERE id = ?').run(indexId)
    const key = `${libraryId}:idx:${indexId}`
    watchers.get(key)?.close().catch(() => undefined)
    watchers.delete(key)
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
