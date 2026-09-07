import { app, shell, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { getDb } from './services/db'
import { closeAllLibHandles, libDbPath } from './services/libraryDb'
import { openSqlite } from './services/sqlite'
import { registerIpc, initServices, attachWatchersFor } from './ipc'
import { registerMediaProtocol } from './services/media'
import { listLibraries } from './services/store'

/** 退出前 checkpoint 全部库 db,保证 .mediahub/library.db 自包含(整目录可携带) */
function checkpointAllLibraries(): void {
  try {
    for (const l of listLibraries(getDb())) {
      try {
        const d = openSqlite(libDbPath(l.path))
        d.pragma('wal_checkpoint(TRUNCATE)')
        d.close()
      } catch { /* 单库失败不影响其余 */ }
    }
  } catch { /* ignore */ }
}

// media:// 需要在 app ready 前声明特权(视频流/Range)
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } },
  { scheme: 'thumb', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true } }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1440,
    minHeight: 860,
    useContentSize: true,
    frame: false,
    show: false,
    backgroundColor: '#D8E9FC',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 单实例锁:第二实例启动时聚焦既有窗口并退出,避免并发写库
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (!w) return
    if (w.isMinimized()) w.restore()
    w.focus()
  })

  app.whenReady().then(() => {
    const userData = app.getPath('userData')
    initServices(userData)
    registerMediaProtocol()
    registerIpc(userData)
    attachWatchersFor(listLibraries(getDb()))

  // 缩略图协议:thumb://<fingerprint>.webp,跨库指纹查找,缺失时排队生成
  protocol.handle('thumb', async (request) => {
    const fp = new URL(request.url).hostname.replace(/\.webp$/, '')
    const { findByFingerprint } = await import('./services/libResolve')
    const { fileExists, ensureThumbByFingerprint } = await import('./services/thumbsLookup')
    const fallbackThumbs = join(app.getPath('userData'), 'thumbs')
    const hit = findByFingerprint(fp, fallbackThumbs)
    if (!hit) return new Response('not found', { status: 404 })
    if (!(await fileExists(hit.thumbPath)) || (hit.sidecarPath != null && !(await fileExists(hit.sidecarPath)))) {
      if (!ensureThumbByFingerprint(fp, fallbackThumbs)) return new Response('not found', { status: 404 })
    }
    try {
      const buf = await import('node:fs/promises').then((f) => f.readFile(hit.thumbPath))
      return new Response(buf, { headers: { 'content-type': 'image/webp' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })

  ipcMain.on('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
  })
  ipcMain.on('window:maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
  ipcMain.on('shell:show-in-folder', (_e, p: string) => {
    if (typeof p === 'string' && p) shell.showItemInFolder(p)
  })

  // dev 下开放本地 HTTP 桥:GET /<js 表达式> 在渲染进程执行并返回 JSON,供无头验证脚本使用
  if (!app.isPackaged) {
    const debugBridge = createServer((req, res) => {
      const expr = decodeURIComponent((req.url ?? '/').slice(1))
      const w = BrowserWindow.getAllWindows()[0]
      if (!w || !expr) {
        res.end(JSON.stringify({ ok: false, error: 'no window or empty expression' }))
        return
      }
      w.webContents.executeJavaScript(expr, true).then(
        (v) => res.end(JSON.stringify({ ok: true, value: v ?? null })),
        (e) => res.end(JSON.stringify({ ok: false, error: String(e) }))
      )
    })
    // 端口只是开发调试工具，不能让被占用的端口变成主进程崩溃。
    debugBridge.on('error', (error) => {
      console.warn('[MediaHub] debug bridge unavailable:', error.message)
    })
    debugBridge.listen(9223, '127.0.0.1')
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    checkpointAllLibraries()
    closeAllLibHandles()
    app.quit()
  }
})
