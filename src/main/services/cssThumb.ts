import { BrowserWindow, session, type Session } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { playerWrapperUrl } from './htmlPlayer'

/**
 * CSS 缩略图:把预览页离屏渲染后截图。
 *
 * CSS 没有位图可解码,sharp 直接处理 .css 只会得到占位图,所以这里借用 Electron
 * 自带的 Chromium 渲染真实效果。窗口不可见、禁脚本、禁外部请求(由预览页 CSP 保证),
 * 并带超时兜底——渲染失败交给调用方落格式占位图。
 */

/** 缩略图源图尺寸:够 640px 长边缩放,不浪费渲染时间 */
const RENDER_WIDTH = 900
const RENDER_HEIGHT = 675
const RENDER_TIMEOUT_MS = 5000
/** HTML 整页渲染要等脚本挂载 DOM,比静态 CSS 预览慢,单独给更宽的超时 */
const HTML_RENDER_TIMEOUT_MS = 8000
/** 在线播放器外壳要先拉播放器与视频包,首帧更慢 */
const HTML_PLAYER_RENDER_TIMEOUT_MS = 20000
const HTML_PLAYER_WAIT_MS = 4000
const HTML_SETTLE_MS = 300
const HTML_CONTENT_WAIT_MS = 2500

/**
 * 渲染一个本地 data URL 页面并截图,返回可供 sharp 处理的 PNG Buffer。
 * 任何失败(超时、窗口创建失败、空图)都抛出,由调用方回退占位图。
 */
async function renderPreviewPng(url: string, filePath?: string): Promise<Buffer> {
  const win = new BrowserWindow({
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      offscreen: true,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      // 预览页脚本已在拼接时剥离,这里是第二道防线
      javascript: false,
      webSecurity: true
    }
  })

  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('css preview render timed out')), RENDER_TIMEOUT_MS)
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer)
        // 等一帧,让 CSS 过渡/字体落到稳定状态再截图
        setTimeout(resolve, 120)
      })
      win.webContents.once('did-fail-load', () => {
        clearTimeout(timer)
        reject(new Error('css preview failed to load'))
      })
    })
    loaded.catch(() => undefined)

    if (filePath) await win.loadFile(filePath)
    else await win.loadURL(url)
    await loaded

    const image = await win.webContents.capturePage()
    const size = image.getSize()
    if (size.width === 0 || size.height === 0) throw new Error('css preview captured an empty frame')
    const png = image.toPNG()
    if (png.length === 0) throw new Error('css preview produced an empty image')
    return png
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/**
 * HTML 缩略图专用的隔离会话:素材页要执行脚本(否则运行时渲染的页面永远是空白),
 * 但绝不允许它发网络请求或弹窗。file:/data:/blob: 放行,其余一律取消——
 * 这样原文件可以直接按真实目录加载,同目录的图片与样式仍能解析。
 */
let htmlThumbSession: Session | null = null
function getHtmlThumbSession(): Session {
  if (htmlThumbSession) return htmlThumbSession
  // 不给素材页留磁盘缓存:每个页面只截一次图,缓存目录纯属残留
  const ses = session.fromPartition('html-thumb', { cache: false })
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !/^(file|data|blob|about|devtools|https?):/i.test(details.url) })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  htmlThumbSession = ses
  return ses
}

/** 等页面把内容渲染出来:运行时框架先给空 body,再靠脚本挂载节点 */
async function waitForHtmlContent(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(
    `(async () => {
      const deadline = Date.now() + ${HTML_CONTENT_WAIT_MS}
      const painted = () => {
        const body = document.body
        if (!body) return false
        if ((body.innerText || '').trim() !== '') return true
        return !!body.querySelector('img,svg,canvas,video,picture')
      }
      while (Date.now() < deadline) {
        if (painted()) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    })()`,
    true
  )
}

/** 按原文件渲染整页并截图;脚本可执行,网络与弹窗被隔离会话挡住。 */
async function renderHtmlPagePng(absPath: string): Promise<Buffer> {
  // 在线播放器外壳必须从 http://localhost:3000 加载:播放器只接受白名单 origin 的消息
  const playerUrl = await playerWrapperUrl(absPath).catch(() => null)
  const win = new BrowserWindow({
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      offscreen: true,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      javascript: true,
      webSecurity: true,
      session: getHtmlThumbSession()
    }
  })

  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('html thumbnail render timed out')),
        playerUrl ? HTML_PLAYER_RENDER_TIMEOUT_MS : HTML_RENDER_TIMEOUT_MS
      )
    })
    try {
      // loadFile 不转义 # 与 ?:文件名含这两个字符时会被当成 hash/query,整页加载失败
      const loaded = win.loadURL(playerUrl ?? pathToFileURL(absPath).href)
      loaded.catch(() => undefined)
      await Promise.race([loaded, timeout])
      // 超时先返回时这个 Promise 还会继续跑,先吞掉它的拒绝,避免 unhandledRejection
      const content = playerUrl
        ? new Promise((resolve) => setTimeout(resolve, HTML_PLAYER_WAIT_MS))
        : waitForHtmlContent(win)
      content.catch(() => undefined)
      await Promise.race([content, timeout])
      // 截图的滚动条会变成卡片右侧一条白边,缩略图里不能带
      await win.webContents.insertCSS('html,body{overflow:hidden!important}::-webkit-scrollbar{display:none!important}')
    } finally {
      if (timer) clearTimeout(timer)
    }
    await new Promise((resolve) => setTimeout(resolve, HTML_SETTLE_MS))
    const image = await win.webContents.capturePage()
    const size = image.getSize()
    if (size.width === 0 || size.height === 0) throw new Error('html thumbnail captured an empty frame')
    const png = image.toPNG()
    if (png.length === 0) throw new Error('html thumbnail produced an empty image')
    return png
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** 渲染用的一次性 HTML 落在库内 `.mediahub/tmp`,不写系统临时盘。 */
export function libraryTempDir(libPath: string): string {
  return join(libPath, '.mediahub', 'tmp')
}

/** 渲染预览 HTML 并截图。 */
export async function renderCssPreviewPng(html: string, tempDir: string): Promise<Buffer> {
  await mkdir(tempDir, { recursive: true })
  const file = join(tempDir, `${randomUUID()}.html`)
  try {
    await writeFile(file, html, 'utf8')
    return await renderPreviewPng('', file)
  } finally {
    await rm(file, { force: true }).catch(() => undefined)
  }
}

/**
 * SVG 缩放改为改写根元素尺寸,不再调 `webContents.setZoomFactor`。
 *
 * Chromium 会把每个文档的 zoom 按 host 记进 Preferences,而 data: URL 的 host 就是整串
 * data URL——渲染一张 8KB 的 SVG 就留下一条 8KB 记录。本机实测 10235 条 / 430MB,
 * 浏览器进程内存被撑到 1.7GB,启动时还要整份解析并回写。
 * 内联 style 的宽高与之等价(等比缩放,内容仍从左上角起算),且不产生任何偏好副作用。
 */
function scaleRootElement(svg: Buffer, width: number, height: number): Buffer {
  const text = svg.toString('utf8')
  const open = text.match(/<svg\b[^>]*>/i)?.[0]
  // 认不出根标签就原样返回:宁可不缩放,也不冒险改坏 XML
  if (!open || /style\s*=\s*'/.test(open)) return svg
  const size = `width:${width}px;height:${height}px`
  const patched = /style\s*=\s*"/i.test(open)
    ? open.replace(/style\s*=\s*"([^"]*)"/i, (_m, value: string) => `style="${value.trim().replace(/;?$/, ';')}${size}"`)
    : open.replace(/\s*\/?>$/, (tail) => ` style="${size}"${tail}`)
  return Buffer.from(text.replace(open, patched), 'utf8')
}

/**
 * SVG 内的 foreignObject 在 sharp/librsvg 和 img 标签中都不可靠,
 * 用隐藏 Chromium 按原始尺寸等比缩放后截图。
 */
export async function renderSvgPreviewPng(absPath: string): Promise<Buffer> {
  const svg = await readFile(absPath)
  const meta = await sharp(svg).metadata()
  const width = Math.max(1, meta.width ?? RENDER_WIDTH)
  const height = Math.max(1, meta.height ?? RENDER_HEIGHT)
  const scale = Math.max(0.1, Math.min(4, RENDER_WIDTH / width, RENDER_HEIGHT / height))
  const scaled = scaleRootElement(svg, width * scale, height * scale)
  const png = await renderPreviewPng(`data:image/svg+xml;base64,${scaled.toString('base64')}`)
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const background = {
    r: data[0] ?? 255,
    g: data[1] ?? 255,
    b: data[2] ?? 255,
    alpha: info.channels === 4 ? (data[3] ?? 255) / 255 : 1
  }
  const trimmed = await sharp(png).trim({ background, threshold: 12 }).toBuffer({ resolveWithObject: true })
  const pad = Math.max(24, Math.round(Math.max(trimmed.info.width, trimmed.info.height) * 0.18))
  return sharp(trimmed.data)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background })
    .png()
    .toBuffer()
}

/** 截图 → 640px 长边 JPEG(与位图缩略图同一编码参数,便于共用缓存目录) */
export async function renderCssThumbJpeg(html: string, size: number, libPath: string): Promise<Buffer> {
  const png = await renderCssPreviewPng(html, libraryTempDir(libPath))
  return sharp(png)
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer()
}

/**
 * 按页面内容边界裁掉四周空白,再铺满画布。
 *
 * 网页常常只有一个 240px 的小卡片居中,整屏截图后在卡片里只剩一小点。
 * 这里先 trim 掉与边角同色的空白,把真实内容放大到占满缩略框;
 * 裁不出内容(纯色页)时退回原图,避免产出空图。
 */
async function trimToContent(png: Buffer, size: number): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  // 取左上角像素当「空白色」:居中卡片的页面四周都铺着网页自己的底色
  const bg = [data[0], data[1], data[2]]
  // sharp 的 trim 依赖 alpha,对 JPEG 渲染出的不透明底色判定不稳,这里自己扫边界
  // 容差必须小于「页面底色 vs 卡片底色」的差值,否则整张卡片会被当成背景一起裁掉
  const isBg = (x: number, y: number): boolean => {
    const i = (y * info.width + x) * 4
    return Math.abs(data[i] - bg[0]) <= 8 && Math.abs(data[i + 1] - bg[1]) <= 8 && Math.abs(data[i + 2] - bg[2]) <= 8
  }
  let top = 0
  let bottom = info.height - 1
  let left = 0
  let right = info.width - 1
  while (top < bottom && rowIsBg(top)) top++
  while (bottom > top && rowIsBg(bottom)) bottom--
  while (left < right && colIsBg(left)) left++
  while (right > left && colIsBg(right)) right--
  function rowIsBg(y: number): boolean {
    for (let x = 0; x < info.width; x++) if (!isBg(x, y)) return false
    return true
  }
  function colIsBg(x: number): boolean {
    for (let y = top; y <= bottom; y++) if (!isBg(x, y)) return false
    return true
  }
  const w = right - left + 1
  const h = bottom - top + 1
  // 内容几乎铺满或几乎为空时都不裁:前者没必要,后者会放大成噪点
  const usable = w * h > info.width * info.height * 0.02 && (w < info.width * 0.98 || h < info.height * 0.98)
  const source = usable
    ? await sharp(png).extract({ left, top, width: w, height: h }).toBuffer()
    : png
  // contain 而不是 cover:裁到内容框后按长边铺满,宽条形卡片不会被横向裁断,
  // 留白用页面自己的底色补,视觉上仍是一整块作品而不是「迷你卡在空画布中间」。
  return sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: bg[0], g: bg[1], b: bg[2], alpha: 1 } })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer()
}

/**
 * HTML 素材缩略图:直接渲染原文件。
 *
 * 不能走 documentPreview —— 它按文档清洗 HTML,会剥掉 <script> 并关掉脚本,
 * 而这类素材(组件站导出的页面)正文由运行时脚本挂载,清洗后只剩一张空白页。
 */
export async function renderHtmlThumbFromFile(absPath: string, size: number): Promise<Buffer> {
  return trimToContent(await renderHtmlPagePng(absPath), size)
}

/**
 * 从库内 CSS 文件渲染缩略图 JPEG。
 * 骨架取同目录同名 HTML,缺失时用内置演示骨架;读盘与渲染失败均抛出,由调用方回退占位图。
 */
export async function renderCssThumbFromFile(libPath: string, absPath: string, size: number): Promise<Buffer> {
  const preview = await import('./cssPreview')
  const relPath = relative(libPath, absPath).replace(/\\/g, '/')
  const [cssText, shell] = await Promise.all([
    readFile(absPath, 'utf8'),
    preview.resolvePreviewShell(libPath, relPath)
  ])
  return renderCssThumbJpeg(preview.buildPreviewHtml(cssText, shell), size, libPath)
}

/**
 * 配套 HTML 的外观签名,供缩略图缓存比对。
 *
 * 配套 HTML 是附属文件:改它不动 CSS 指纹,只按指纹判缓存会沿用旧封面。
 * 用内容 sha1 当签名,HTML 一改即失效;没有配套 HTML 时返回空串。
 */
export async function resolveShellSignature(libPath: string, absPath: string): Promise<string> {
  const preview = await import('./cssPreview')
  const relPath = relative(libPath, absPath).replace(/\\/g, '/')
  const shell = await preview.resolvePreviewShell(libPath, relPath)
  if (shell == null) return ''
  return createHash('sha1').update(shell).digest('hex').slice(0, 16)
}
