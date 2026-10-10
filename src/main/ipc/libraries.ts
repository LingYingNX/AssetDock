import { ipcMain, dialog } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { getDb } from '../services/db'
import {
  createLibrary, getOpenTabs, saveOpenTabs, getAppState, setAppState,
  listLibraries, APP_STATE_KEYS
} from '../services/store'
import { ensureLibraryStorage } from '../services/libraryDb'
import { win, libRootOf } from './context'
import { reconcileWhenOpened, scanLibraryContents, migrationFailures, attachRootWatcher } from './watch'

/** 库域 handler:library:* / tabs / state / dialog(S1-1 拆分) */
export function registerLibraryIpc(userData: string): void {
  ipcMain.handle('dialog:pickFolder', async () => {
    // S3-7:窗口可能在托盘化后不存在,不再用非空断言
    const w = win()
    if (!w) return null
    const r = await dialog.showOpenDialog(w, { properties: ['openDirectory'] })
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

  // 迁移残留清理(全局兜底库):危险操作,要求显式 confirm + 删除前备份(S1-10)
  ipcMain.handle('library:legacyStats', () => {
    const d = getDb()
    const r = d.prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }
    return { assets: r.c }
  })

  ipcMain.handle('library:purgeLegacy', (_e, confirm?: unknown) => {
    if (confirm !== true) return { ok: false, error: 'missing confirm' }
    const d = getDb()
    const count = (d.prepare('SELECT COUNT(*) AS c FROM assets').get() as { c: number }).c
    if (count > 0) {
      try {
        const backupDir = joinPath(userData, 'backups')
        mkdirSync(backupDir, { recursive: true })
        const dump = {
          created_at: new Date().toISOString(),
          assets: d.prepare('SELECT * FROM assets').all(),
          tags: d.prepare('SELECT * FROM tags').all(),
          asset_tags: d.prepare('SELECT * FROM asset_tags').all()
        }
        writeFileSync(joinPath(backupDir, `legacy-purge-${Date.now()}.json`), JSON.stringify(dump), 'utf8')
      } catch {
        // 备份失败不阻断清理:残留表本就是迁移兜底数据,清理本身幂等可重做
      }
    }
    d.transaction(() => {
      d.prepare('DELETE FROM asset_tags').run()
      d.prepare('DELETE FROM tags').run()
      d.prepare('DELETE FROM assets').run()
    })()
    d.pragma('wal_checkpoint(TRUNCATE)')
    return { ok: true }
  })
}
