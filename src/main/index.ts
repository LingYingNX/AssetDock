import { app, shell, BrowserWindow, ipcMain, protocol, screen, Tray, nativeImage } from 'electron'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { getDb } from './services/db'
import { closeAllLibHandles, libDbPath } from './services/libraryDb'
import { openSqlite } from './services/sqlite'
import { registerIpc, initServices, attachWatchersFor } from './ipc'
import { destroyTrayMenu, hideTrayMenu, isTrayMenuVisible, showTrayMenu } from './trayMenu'
import { registerMediaProtocol } from './services/media'
import { listLibraries, getAppState, setAppState } from './services/store'
import { resolveWithinAnyLibrary } from './services/libResolve'
import { checkForUpdate, downloadUpdate, updateCacheDir } from './services/appUpdate'
import { send } from './events'

const DEFAULT_WINDOW = { width: 1600, height: 950 }
/* 设计基准是 1920×1080。最小尺寸必须明显小于基准,否则窄屏/分屏下窗口本身就被
   系统挡住,用户连缩窄都做不到 —— 界面各层改为在基准以下自适应(见 tokens.css 的 body
   与 content.css 的 .filterbar)。 */
const MIN_WINDOW = { width: 1024, height: 640 }
const WINDOW_STATE_KEY = 'windowBounds'

// 无头/真实窗口验证使用独立 userData，避免测试触碰用户的库注册表。
if (!app.isPackaged && process.env.MEDIAHUB_TEST_USER_DATA) {
  app.setPath('userData', resolve(process.env.MEDIAHUB_TEST_USER_DATA))
}

/**
 * 偏好中的关闭行为:minimize=关闭时隐藏窗口,quit=直接退出应用。
 * 默认 quit:点右上角 X 却"什么都没发生"是最容易让人以为改动没生效的一种反馈,
 * 想常驻后台的用户可以在设置里显式选「最小化」。
 */
function closeBehavior(): 'minimize' | 'quit' {
  try {
    const prefs = JSON.parse(getAppState(getDb(), 'preferences') ?? '{}') as { closeAction?: unknown }
    return prefs.closeAction === 'minimize' ? 'minimize' : 'quit'
  } catch {
    return 'quit'
  }
}

interface StoredBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

/**
 * 读取上次窗口尺寸。位置仅在仍与某块显示器相交时采用,否则丢弃坐标
 * (显示器拔掉/分辨率变化后,沿用旧坐标会让窗口落在屏幕外不可见)。
 */
function readWindowState(): StoredBounds | null {
  try {
    const raw = getAppState(getDb(), WINDOW_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredBounds>
    const width = Number(parsed.width)
    const height = Number(parsed.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    const bounds: StoredBounds = {
      width: Math.max(MIN_WINDOW.width, Math.round(width)),
      height: Math.max(MIN_WINDOW.height, Math.round(height)),
      maximized: parsed.maximized === true
    }
    const x = Number(parsed.x)
    const y = Number(parsed.y)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea
        return x < a.x + a.width && x + bounds.width > a.x && y < a.y + a.height && y + bounds.height > a.y
      })
      if (visible) {
        bounds.x = Math.round(x)
        bounds.y = Math.round(y)
      }
    }
    return bounds
  } catch {
    return null
  }
}

/** 退出前落盘窗口尺寸;最大化/最小化时保留上一次的普通尺寸,避免记住最大化态的数字 */
function persistWindowState(win: BrowserWindow): void {
  try {
    if (win.isDestroyed()) return
    const maximized = win.isMaximized()
    const bounds = maximized ? win.getNormalBounds() : win.getBounds()
    setAppState(getDb(), WINDOW_STATE_KEY, JSON.stringify({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized
    }))
  } catch { /* 落盘失败不影响退出 */ }
}

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

// media:// 需要在 app ready 前声明特权(视频流/Range)。
// S0-1:去掉 bypassCSP——页面 CSP(index.html meta)已显式放行 media:,
// 无需协议级豁免;保留 fetch 能力(connect-src media:)与流式播放。
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: false } }
])

let tray: Tray | null = null
let mainWin: BrowserWindow | null = null

/** 唤回主窗口:可能已隐藏到托盘,也可能已被关闭 */
function showMainWindow(): void {
  const win = mainWin && !mainWin.isDestroyed() ? mainWin : null
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 最小化到托盘时第一次创建;右键提供「打开面板 / 退出」 */
function ensureTray(): void {
  if (tray) return
  const image = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16, quality: 'best' }))
  tray.setToolTip('MediaHub 素材管理器')
  tray.on('click', () => hideTrayMenu())
  tray.on('right-click', () => {
    if (!tray) return
    if (isTrayMenuVisible()) {
      hideTrayMenu()
    } else {
      showTrayMenu(tray, showMainWindow)
    }
  })
}
function createWindow(): void {
  const stored = readWindowState()
  const win = new BrowserWindow({
    width: stored?.width ?? DEFAULT_WINDOW.width,
    height: stored?.height ?? DEFAULT_WINDOW.height,
    ...(stored?.x != null && stored?.y != null ? { x: stored.x, y: stored.y } : {}),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    useContentSize: true,
    frame: false,
    show: false,
    // 圆角窗口:窗口本身透明,圆角与底色由渲染层自绘(.app 圆角 + overflow:hidden)
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox:true(S2-13):preload 只用 ipcRenderer/contextBridge,无需 Node 权限;
      // 渲染层被注入时少一层 Node 能力暴露
      sandbox: true
    }
  })

  // 先应用最大化态再显示,避免出现「先小窗后跳大」的闪烁
  if (stored?.maximized) win.maximize()

  win.on('ready-to-show', () => win.show())

  // 缩放/移动结束后落盘(拖动过程会高频触发,用防抖收敛写入)
  let persistTimer: NodeJS.Timeout | null = null
  const schedulePersist = (): void => {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistWindowState(win)
    }, 400)
  }
  win.on('resize', schedulePersist)
  win.on('move', schedulePersist)
  win.on('maximize', schedulePersist)
  win.on('unmaximize', schedulePersist)

  // 最大化时窗口铺满屏幕,圆角会在四角露出桌面底色,因此通知渲染层去掉圆角
  const sendMaximized = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send('window:maximized', win.isMaximized())
  }
  mainWin = win
  win.on('maximize', sendMaximized)
  win.on('unmaximize', sendMaximized)
  win.webContents.on('did-finish-load', sendMaximized)
  // 关闭行为:偏好为「最小化」时拦截关闭改为 hide()。注意 hide() 不是最小化:
  // 窗口已隐藏到托盘:托盘菜单、托盘单击或再次启动都能唤回(见 second-instance)。
  // 真正退出走 app.quit 标记。
  let quitting = false
  app.on('before-quit', () => { quitting = true; destroyTrayMenu(); tray?.destroy(); tray = null })
  win.on('close', (event) => {
    if (persistTimer) clearTimeout(persistTimer)
    persistWindowState(win)
    if (!quitting && closeBehavior() === 'minimize') {
      event.preventDefault()
      // S2-8:托盘化前 checkpoint,长期挂后台时 WAL 不持续增长,断电恢复更快
      checkpointAllLibraries()
      ensureTray()
      win.hide()
    }
  })

  // 仅放行 http(s) 外链;file:// 与自定义协议不交给系统 handler,防被注入页借道打开本地内容
  win.webContents.setWindowOpenHandler((details) => {
    if (/^https?:/i.test(details.url)) shell.openExternal(details.url)
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
  app.on('second-instance', () => { showMainWindow() })

  app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    initServices(userData)
    registerMediaProtocol()
    registerIpc()
    await attachWatchersFor(listLibraries(getDb()))

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
  // 路径必须真实落在某个已注册库根内(realpath 解析符号链接),库外拒绝——
  // 防渲染层被注入后探测任意磁盘路径存在性或在资源管理器打开敏感目录
  ipcMain.on('shell:show-in-folder', async (_e, p: string) => {
    if (typeof p !== 'string' || !p) return
    const real = await resolveWithinAnyLibrary(p)
    if (real) shell.showItemInFolder(real)
  })

  /** 开机自启:走 Electron 登录项,仅打包后生效(dev 下注册的是 electron.exe 无意义) */
  ipcMain.handle('app:getAutoLaunch', () => {
    if (!app.isPackaged) return { enabled: false, supported: false }
    return { enabled: app.getLoginItemSettings().openAtLogin, supported: true }
  })
  ipcMain.handle('app:setAutoLaunch', (_e, enabled: boolean) => {
    if (!app.isPackaged) return { ok: false, supported: false }
    app.setLoginItemSettings({ openAtLogin: enabled === true })
    return { ok: true, supported: true, enabled: app.getLoginItemSettings().openAtLogin }
  })

  /** 关于面板：版本号来自打包后的 package.json，dev 下回落到 package.json 的 version 字段 */
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('app:checkUpdate', () => checkForUpdate(app.getVersion()))

  /* 下载进度走事件通道而不是 invoke 返回值：流式下载耗时不可控，
     invoke 只能在结束时给一次结果，进度条要靠主进程持续推送。 */
  ipcMain.handle('app:downloadUpdate', async (_e, url: string) => {
    // 渲染层只能触发 http(s) 下载：主进程的 fetch 不该被用来探测/读取本地文件
    let protocol = ''
    try {
      protocol = new URL(String(url ?? '')).protocol
    } catch {
      return { ok: false, error: '无效的下载地址' }
    }
    if (protocol !== 'https:' && protocol !== 'http:') return { ok: false, error: '不支持的下载地址' }
    const dest = join(updateCacheDir(app.getPath('userData')), `update-${Date.now()}.bin`)
    try {
      await downloadUpdate(url, dest, (p) => send('update:progress', p))
      return { ok: true, path: dest }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '下载失败' }
    }
  })

  // dev 下开放本地 HTTP 桥:GET /<token>/<js 表达式> 在渲染进程执行并返回 JSON,供无头验证脚本使用。
  // token 每次启动随机生成并落盘 userData/debug-bridge-token(tools/hhead.mjs 消费),
  // 防止同机任意进程(包括浏览器页面)盲打 9223 驱动渲染层执行任意 JS
  if (!app.isPackaged) {
    const bridgeToken = randomUUID()
    try {
      writeFileSync(join(userData, 'debug-bridge-token'), bridgeToken, 'utf8')
    } catch (e) {
      console.warn('[MediaHub] debug bridge token write failed:', (e as Error).message)
    }
    const debugBridge = createServer((req, res) => {
      const raw = decodeURIComponent((req.url ?? '/').slice(1))
      const sep = raw.indexOf('/')
      const token = sep === -1 ? raw : raw.slice(0, sep)
      const expr = sep === -1 ? '' : raw.slice(sep + 1)
      const w = BrowserWindow.getAllWindows()[0]
      if (token !== bridgeToken || !w || !expr) {
        res.statusCode = token !== bridgeToken ? 403 : 400
        res.end(JSON.stringify({ ok: false, error: token !== bridgeToken ? 'forbidden' : 'no window or empty expression' }))
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
    const debugPort = Number(process.env.MEDIAHUB_TEST_BRIDGE_PORT)
    debugBridge.listen(Number.isInteger(debugPort) && debugPort > 0 ? debugPort : 9223, '127.0.0.1')
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
