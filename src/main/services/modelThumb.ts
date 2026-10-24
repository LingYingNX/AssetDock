import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const RENDER_WIDTH = 900
const RENDER_HEIGHT = 675
const RENDER_TIMEOUT_MS = 30_000

function rendererUrl(params: URLSearchParams): string {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return `${dev.replace(/\/$/, '')}/?${params}`
  const html = pathToFileURL(join(__dirname, '../renderer/index.html')).href
  return `${html}?${params}`
}

async function waitForModel(win: BrowserWindow): Promise<void> {
  const deadline = Date.now() + RENDER_TIMEOUT_MS
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript(
      'window.__modelThumbState || "loading"',
      true
    ) as string
    if (state === 'ready') return
    if (state === 'error') throw new Error('3D model thumbnail render failed')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('3D model thumbnail render timed out')
}

export async function renderModelPreviewPng(url: string, format: string): Promise<Buffer> {
  const params = new URLSearchParams({ modelThumb: '1', url, format })
  const win = new BrowserWindow({
    width: RENDER_WIDTH,
    height: RENDER_HEIGHT,
    show: false,
    frame: false,
    backgroundColor: '#e5e9ee',
    webPreferences: {
      offscreen: true,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  })

  try {
    await win.loadURL(rendererUrl(params))
    await waitForModel(win)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const image = await win.webContents.capturePage()
    const size = image.getSize()
    if (size.width === 0 || size.height === 0) throw new Error('3D thumbnail captured an empty frame')
    return image.toPNG()
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function renderModelThumbJpeg(url: string, format: string, size: number): Promise<Buffer> {
  const png = await renderModelPreviewPng(url, format)
  return sharp(png)
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer()
}
