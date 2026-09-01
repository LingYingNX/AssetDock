import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { createServer } from 'node:http'

// dev 下开放本地 HTTP 桥:GET /<js 表达式> 在渲染进程执行并返回 JSON,供无头验证脚本使用
if (!app.isPackaged) {
  createServer((req, res) => {
    const expr = decodeURIComponent((req.url ?? '/').slice(1))
    const win = BrowserWindow.getAllWindows()[0]
    if (!win || !expr) {
      res.end(JSON.stringify({ ok: false, error: 'no window or empty expression' }))
      return
    }
    win.webContents.executeJavaScript(expr, true).then(
      (v) => res.end(JSON.stringify({ ok: true, value: v ?? null })),
      (e) => res.end(JSON.stringify({ ok: false, error: String(e) }))
    )
  }).listen(9223, '127.0.0.1')
}

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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
