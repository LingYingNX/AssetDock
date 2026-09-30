import { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

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

/**
 * 渲染预览 HTML 并截图,返回可供 sharp 处理的 PNG Buffer。
 * 任何失败(超时、窗口创建失败、空图)都抛出,由调用方回退占位图。
 */
export async function renderCssPreviewPng(html: string): Promise<Buffer> {
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

    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
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

/** 截图 → 640px 长边 JPEG(与位图缩略图同一编码参数,便于共用缓存目录) */
export async function renderCssThumbJpeg(html: string, size: number): Promise<Buffer> {
  const png = await renderCssPreviewPng(html)
  return sharp(png)
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer()
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
  return renderCssThumbJpeg(preview.buildPreviewHtml(cssText, shell), size)
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