import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getDb, initDb } from './services/db'
import {
  createLibrary, listLibraries, getLibrary, listAssets, updateAsset, addTag, removeTag,
  upsertScanned, getOpenTabs, saveOpenTabs, getAppState, setAppState
} from './services/store'
import { scanLibrary } from './services/scan'
import { watchLibrary } from './services/watch'
import { probeVideo } from './services/videoMeta'
import { initThumbs, ensureThumb, hasThumb, thumbPath } from './services/thumbs'
import { extractPaletteFromThumb } from './services/palette'
import type { AssetPatch } from './services/store'
import type { FSWatcher } from 'chokidar'

let userDataDir = '.'
const watchers = new Map<number, FSWatcher>()

function win(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function send(channel: string, payload: unknown): void {
  win()?.webContents.send(channel, payload)
}

/** 扫描 → 入库 → 逐个缩略图+调色板;完成后发事件 */
async function scanAndIndex(libraryId: number): Promise<void> {
  const db = getDb()
  const lib = getLibrary(db, libraryId)
  if (!lib) return
  const entries = await scanLibrary(lib.path, (done) => send('library:scan', { libraryId, done, phase: 'scanning' }))
  upsertScanned(db, libraryId, entries)
  send('library:scan', { libraryId, done: entries.length, phase: 'done', added: entries.length })
  for (const e of entries) {
    const row = db
      .prepare('SELECT id, fingerprint FROM assets WHERE library_id = ? AND rel_path = ?')
      .get(libraryId, e.relPath) as { id: number; fingerprint: string } | undefined
    if (!row) continue
    await ensureThumbAndPalette(libraryId, row.id, joinPath(lib.path, e.relPath), e.type, e.format, row.fingerprint)
  }
}

import { join as joinPath } from 'node:path'

async function ensureThumbAndPalette(
  libraryId: number,
  assetId: number,
  absPath: string,
  type: 'image' | 'video' | 'model',
  format: string,
  fingerprint: string
): Promise<void> {
  const db = getDb()
  const r = await ensureThumb({ fingerprint, absPath, type, format }).catch(() => null)
  if (!r) return
  send('thumbs:ready', { fingerprint })
  const needsPalette = type === 'image' && !r.placeholder
  if (needsPalette) {
    const palette = await extractPaletteFromThumb(r.path).catch(() => [])
    if (palette.length > 0) {
      updateAsset(db, assetId, { palette: JSON.stringify(palette) })
      send('thumbs:ready', { fingerprint })
    }
  }
  void libraryId
}

/** 后台为缺缩略图/缺调色板的素材补齐 */
async function backfillLibrary(libraryId: number): Promise<void> {
  const db = getDb()
  const lib = getLibrary(db, libraryId)
  if (!lib) return
  const rows = db
    .prepare('SELECT id, rel_path, type, format, fingerprint FROM assets WHERE library_id = ? AND missing = 0')
    .all(libraryId) as { id: number; rel_path: string; type: 'image' | 'video' | 'model'; format: string; fingerprint: string }[]
  for (const row of rows) {
    if (!(await hasThumb(row.fingerprint))) {
      await ensureThumbAndPalette(libraryId, row.id, joinPath(lib.path, row.rel_path), row.type, row.format, row.fingerprint)
    } else if (row.type === 'image') {
      const p = JSON.stringify(await extractPaletteFromThumb(thumbPath(row.fingerprint)).catch(() => []))
      if (p !== '[]') {
        const cur = db.prepare('SELECT palette FROM assets WHERE id = ?').get(row.id) as { palette: string }
        if (cur.palette === '[]') {
          updateAsset(db, row.id, { palette: p })
          send('thumbs:ready', { fingerprint: row.fingerprint })
        }
      }
    }
  }
}

export function registerIpc(userData: string): void {
  userDataDir = userData
  initThumbs(userData)

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win()!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('library:create', (_e, folderPath: string) => {
    const db = getDb()
    const name = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? folderPath
    const lib = createLibrary(db, name, folderPath)
    if ('error' in lib) return lib
    void scanAndIndex(lib.id).then(() => backfillLibrary(lib.id))
    attachWatcher(lib.id, folderPath)
    return lib
  })

  ipcMain.handle('library:list', () => listLibraries(getDb()))

  ipcMain.handle('assets:list', (_e, libraryId: number) => {
    const db = getDb()
    const lib = getLibrary(db, libraryId)
    if (!lib) return { error: 'library not found' }
    const rows = listAssets(db, libraryId)
    void backfillLibrary(libraryId)
    return {
      library: { id: lib.id, name: lib.name, path: lib.path },
      assets: rows.map((r) => ({ ...r, absPath: joinPath(lib.path, r.rel_path) }))
    }
  })

  ipcMain.handle('assets:update', (_e, id: number, patch: AssetPatch) => {
    updateAsset(getDb(), id, patch)
    return { ok: true }
  })

  ipcMain.handle('assets:addTag', (_e, id: number, name: string) => {
    addTag(getDb(), id, name)
    return { ok: true }
  })

  ipcMain.handle('assets:removeTag', (_e, id: number, name: string) => {
    removeTag(getDb(), id, name)
    return { ok: true }
  })

  ipcMain.handle('assets:emptyTrash', (_e, libraryId: number) => {
    const db = getDb()
    db.prepare('DELETE FROM assets WHERE library_id = ? AND deleted_at IS NOT NULL').run(libraryId)
    return { ok: true }
  })

  /* 清理缺失记录:missing=1 且文件确实不存在的行(二重校验),不动任何磁盘文件 */
  ipcMain.handle('assets:purgeMissing', async (_e, libraryId: number) => {
    const db = getDb()
    const rows = db
      .prepare('SELECT id, rel_path FROM assets WHERE library_id = ? AND missing = 1')
      .all(libraryId) as { id: number; rel_path: string }[]
    const lib = getLibrary(db, libraryId)
    if (!lib) return { purged: 0 }
    const { access } = await import('node:fs/promises')
    let purged = 0
    for (const r of rows) {
      const gone = await access(joinPath(lib.path, r.rel_path)).then(() => false, () => true)
      if (gone) {
        db.prepare('DELETE FROM assets WHERE id = ?').run(r.id)
        purged++
      }
    }
    return { purged }
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

  ipcMain.handle('thumbs:path', (_e, fingerprint: string) => {
    return { path: thumbPath(fingerprint), exists: null }
  })
}

export function initServices(userData: string): void {
  userDataDir = userData
  initDb(userData)
  void userDataDir
}

/** 启动时恢复各库监听,并为 v2 迁移前的旧行补齐 codec/fps/面数 */
export function attachWatchersFor(libraries: { id: number; path: string }[]): void {
  for (const l of libraries) attachWatcher(l.id, l.path)
  for (const l of libraries) void enrichMissingMeta(l.id, l.path)
}

/** 旧记录补齐:视频缺 codec/fps、GLB 缺面数的行重探一次 */
async function enrichMissingMeta(libraryId: number, root: string): Promise<void> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, rel_path, type, format FROM assets
       WHERE library_id = ? AND missing = 0 AND deleted_at IS NULL
         AND ((type = 'video' AND codec IS NULL) OR (type = 'model' AND format = 'GLB' AND face_count IS NULL))`
    )
    .all(libraryId) as { id: number; rel_path: string; type: 'video' | 'model'; format: string }[]
  if (rows.length === 0) return
  for (const r of rows) {
    const abs = joinPath(root, r.rel_path)
    if (r.type === 'video') {
      const m = await probeVideo(abs)
      updateAsset(db, r.id, { codec: m.codec ?? null, fps: m.fps ?? null, width: m.width, height: m.height, duration: m.duration })
    }
  }
  send('assets:changed', { libraryId })
}

function attachWatcher(libraryId: number, root: string): void {
  if (watchers.has(libraryId)) return
  const db = getDb()
  const w = watchLibrary(db, libraryId, root, {
    onAdded: (id) => {
      if (id != null) void backfillAsset(libraryId, id)
      send('assets:changed', { libraryId })
    },
    onChanged: () => send('assets:changed', { libraryId }),
    onMissing: () => send('assets:changed', { libraryId })
  })
  watchers.set(libraryId, w)
}

async function backfillAsset(libraryId: number, assetId: number): Promise<void> {
  const db = getDb()
  const lib = getLibrary(db, libraryId)
  const row = db
    .prepare('SELECT rel_path, type, format, fingerprint FROM assets WHERE id = ?')
    .get(assetId) as { rel_path: string; type: 'image' | 'video' | 'model'; format: string; fingerprint: string } | undefined
  if (!lib || !row) return
  await ensureThumbAndPalette(libraryId, assetId, joinPath(lib.path, row.rel_path), row.type, row.format, row.fingerprint)
}
