import { ipcMain, dialog } from 'electron'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDb } from '../services/db'
import {
  createLibrary, getLibrary, getOpenTabs, saveOpenTabs, getAppState, setAppState,
  listLibraries, APP_STATE_KEYS
} from '../services/store'
import { ensureLibraryStorage } from '../services/libraryDb'
import { rememberPickedPath, validateLibraryCreatePath, type PickedPathMap } from '../services/libraryCreate'
import { configuredToolPath, probeTool } from '../services/externalTools'
import { EXT_WHITELIST } from '../services/ignore'
import { win, libRootOf } from './context'
import { reconcileWhenOpened, scanLibraryContents, migrationFailures, attachRootWatcher, watchManager } from './watch'

const pickedLibraryPaths: PickedPathMap = new Map()

/** 库域 handler:library:* / tabs / state / dialog(S1-1 拆分) */
export function registerLibraryIpc(): void {
  ipcMain.handle('dialog:pickFolder', async () => {
    // S3-7:窗口可能在托盘化后不存在,不再用非空断言
    const w = win()
    if (!w) return null
    const r = await dialog.showOpenDialog(w, { properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    rememberPickedPath(pickedLibraryPaths, r.filePaths[0])
    return r.filePaths[0]
  })

  ipcMain.handle('dialog:pickFile', async () => {
    const w = win()
    if (!w) return null
    const r = await dialog.showOpenDialog(w, {
      properties: ['openFile'],
      filters: [{ name: '可执行文件', extensions: ['exe', 'cmd', 'bat'] }]
    })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:pickAssetFiles', async () => {
    const w = win()
    if (!w) return []
    const r = await dialog.showOpenDialog(w, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '素材文件', extensions: Object.keys(EXT_WHITELIST) }]
    })
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('tools:status', async () => {
    const prefs = getAppState(getDb(), 'preferences')
    const [blender, cinema4d] = await Promise.all([
      probeTool('blender', configuredToolPath(prefs, 'blender')),
      probeTool('cinema4d', configuredToolPath(prefs, 'cinema4d'))
    ])
    return { blender, cinema4d }
  })

  ipcMain.handle('library:open', (_e, libraryId: number) => {
    if (!libRootOf(libraryId)) return { ok: false }
    reconcileWhenOpened(libraryId)
    return { ok: true }
  })

  ipcMain.handle('library:create', async (_e, folderPath: string, requestedName?: string) => {
    const checked = await validateLibraryCreatePath(pickedLibraryPaths, folderPath)
    if (!checked.ok) return { error: checked.error }
    const realPath = checked.path
    const db = getDb()
    const bound = listLibraries(db).find((l) => l.path.toLowerCase() === realPath.toLowerCase())
    if (bound) return bound // 已绑定:直接当重开处理
    const name = typeof requestedName === 'string' && requestedName.trim()
      ? requestedName.trim()
      : realPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? realPath
    const lib = createLibrary(db, name, realPath)
    if ('error' in lib) return lib
    const storageReady = ensureLibraryStorage(db, lib)
    attachRootWatcher(lib.id, realPath)
    void scanLibraryContents(lib.id)
    return storageReady ? lib : { ...lib, warning: '素材库无法创建本地数据库，当前会话将使用全局回退数据' }
  })

  ipcMain.handle('library:list', () => listLibraries(getDb()).map((l) => ({ ...l, exists: existsSync(l.path) })))

  /* 路径丢失后的重新绑定:只改注册表路径,文件夹里的 .mediahub/library.db 跟着目录走 */
  ipcMain.handle('library:relocate', async (_e, libraryId: number, nextPath: string) => {
    const db = getDb()
    const lib = getLibrary(db, libraryId)
    if (!lib) return { error: '资源库不存在' }
    if (typeof nextPath !== 'string' || !nextPath.trim()) return { error: '路径无效' }
    const real = resolve(nextPath)
    let isDir = false
    try { isDir = statSync(real).isDirectory() } catch { isDir = false }
    if (!isDir) return { error: '所选文件夹不存在或不是文件夹' }
    const taken = listLibraries(db).some((l) => l.id !== libraryId && l.path.toLowerCase() === real.toLowerCase())
    if (taken) return { error: '该文件夹已绑定为其他资源库' }
    db.prepare('UPDATE libraries SET path = ? WHERE id = ?').run(real, libraryId)
    const updated = { ...lib, path: real }
    await watchManager.close(`${libraryId}:root`)
    ensureLibraryStorage(db, updated)
    attachRootWatcher(libraryId, real)
    void scanLibraryContents(libraryId)
    return { library: updated }
  })

  /* 原路径已被删除:重建空文件夹并重新挂载,等同于换了一个新目录 */
  ipcMain.handle('library:ensureFolder', async (_e, libraryId: number) => {
    const db = getDb()
    const lib = getLibrary(db, libraryId)
    if (!lib) return { error: '资源库不存在' }
    try { mkdirSync(lib.path, { recursive: true }) } catch { return { error: '无法创建文件夹，请改用「选择文件夹」' } }
    await watchManager.close(`${libraryId}:root`)
    ensureLibraryStorage(db, lib)
    attachRootWatcher(libraryId, lib.path)
    void scanLibraryContents(libraryId)
    return { library: lib }
  })

  /* 只取消登记:不删磁盘文件,也不动目录下的 .mediahub */
  ipcMain.handle('library:remove', async (_e, libraryId: number) => {
    const db = getDb()
    const lib = getLibrary(db, libraryId)
    if (!lib) return { error: '资源库不存在' }
    db.prepare('DELETE FROM libraries WHERE id = ?').run(libraryId)
    const tabs = getOpenTabs(db).filter((t) => t.libraryId !== libraryId)
    saveOpenTabs(db, tabs.map((t) => t.libraryId))
    await watchManager.close(`${libraryId}:root`)
    return { ok: true }
  })

  ipcMain.handle('library:takeMigrationFailures', () => ({ names: migrationFailures.splice(0) }))

  ipcMain.handle('tabs:get', () => getOpenTabs(getDb()))
  ipcMain.handle('tabs:save', (_e, ids: number[]) => {
    saveOpenTabs(getDb(), ids)
    return { ok: true }
  })

  // app_state 键白名单(S1-9):未注册键/非法值直接拒绝,渲染层不能写任意键
  ipcMain.handle('state:get', (_e, key: string) => {
    if (typeof key !== 'string' || !(key in APP_STATE_KEYS)) return null
    return getAppState(getDb(), key)
  })
  ipcMain.handle('state:set', (_e, key: string, value: string) => {
    if (typeof key !== 'string' || typeof value !== 'string') return { ok: false }
    try {
      setAppState(getDb(), key, value)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

}
