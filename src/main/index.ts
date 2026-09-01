import { app, shell, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { registerIpc, initServices, attachWatchersFor } from './ipc'
import { registerMediaProtocol } from './services/media'
import { listLibraries } from './services/store'
import { getDb } from './services/db'

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

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  initServices(userData)
  registerMediaProtocol(getDb())
  registerIpc(userData)
  attachWatchersFor(listLibraries(getDb()))

  // 缩略图协议:thumb://<fingerprint>.webp,缓存缺失时即时排队生成
  protocol.handle('thumb', async (request) => {
    const fp = new URL(request.url).hostname.replace(/\.webp$/, '')
    const { hasThumb, thumbPath, ensureThumbByFingerprint } = await import('./services/thumbsLookup')
    if (!(await hasThumb(fp))) {
      if (!ensureThumbByFingerprint(fp)) return new Response('not found', { status: 404 })
    }
    try {
      const buf = await import('node:fs/promises').then((f) => f.readFile(thumbPath(fp)))
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
    createServer((req, res) => {
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
    }).listen(9223, '127.0.0.1')
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
