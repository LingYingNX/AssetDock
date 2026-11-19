import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { getDb } from './db'
import { listLibraries } from './store'
import { realPathWithinRoot } from './libResolve'

/**
 * 21st 播放器外壳页(<iframe src="https://player.21st.app/...">)只接受来自
 * https://21st.dev / https://*.21st.dev / http://localhost:3000 的 postMessage。
 * 本地 file:// 与 media:// 的 origin 都不在名单里,播放器直接丢弃消息,页面永远黑屏。
 *
 * 这里用 127.0.0.1:3000 回放外壳页,让 origin 命中播放器白名单;端口是播放器写死的,
 * 被占用时只能退回原行为(黑图),不做抢占。
 */
const PORT = 3000
const PLAYER_HOST = 'player.21st.app'
const PLAYER_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline' 'unsafe-eval' https: http: data: blob:; " +
  "style-src 'unsafe-inline' https: http: data:; " +
  "img-src data: blob: https: http:; " +
  "font-src data: https: http:; " +
  "media-src data: blob: https: http:; " +
  "connect-src https: http: data: blob:; " +
  `frame-src https://${PLAYER_HOST}; object-src 'none'; base-uri 'none'; form-action 'none'`

/** 只认真正依赖在线播放器外壳的页面,普通 HTML 继续走 file:// 渲染。 */
export function isPlayerWrapperHtml(html: string): boolean {
  return html.includes('21st-video:load') && html.includes(PLAYER_HOST)
}

/** 外壳页默认不自动播放;缩略图要看到内容,必须让播放器从第 0 帧动起来。 */
export function withPlayerAutoplay(html: string): string {
  return html.replace(/"mode"\s*:\s*"block"/, '"mode":"block","autoPlay":true')
}

/** 普通 HTML 返回 null;播放器外壳返回本地宿主 URL(端口占用时同样为 null)。 */
export async function playerWrapperUrl(absPath: string): Promise<string | null> {
  const html = await readFile(absPath, 'utf8').catch(() => null)
  if (!html || !isPlayerWrapperHtml(html)) return null
  const url = await ensureHtmlPlayerServer()
  return url ? `${url}/html?p=${encodeURIComponent(absPath)}` : null
}
let base: string | null = null
let starting: Promise<string | null> | null = null

export function ensureHtmlPlayerServer(): Promise<string | null> {
  if (base) return Promise.resolve(base)
  if (starting) return starting
  starting = start().then((url) => {
    base = url
    starting = null
    return url
  })
  return starting
}

async function start(): Promise<string | null> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method !== 'GET' || url.pathname !== '/html') return respond(res, 404, 'text/plain', 'not found')
    const absPath = url.searchParams.get('p')
    if (!absPath || !/\.html?$/i.test(absPath)) return respond(res, 404, 'text/plain', 'not found')
    const real = await resolveInLibraries(absPath)
    if (!real) return respond(res, 403, 'text/plain', 'forbidden')
    const html = await readFile(real, 'utf8').catch(() => null)
    if (!html || !isPlayerWrapperHtml(html)) return respond(res, 404, 'text/plain', 'not found')
    respond(res, 200, 'text/html; charset=utf-8', withPlayerAutoplay(html), PLAYER_CSP)
  })
  const listening = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false))
    server.listen(PORT, '127.0.0.1', () => resolve(true))
  })
  if (!listening) {
    console.warn(`[htmlPlayer] 端口 ${PORT} 被占用,在线播放器外壳页无法预览`)
    return null
  }
  return `http://localhost:${PORT}`
}

async function resolveInLibraries(absPath: string): Promise<string | null> {
  for (const lib of listLibraries(getDb())) {
    const real = await realPathWithinRoot(lib.path, absPath)
    if (real) return real
  }
  return null
}

function respond(
  res: import('node:http').ServerResponse,
  status: number,
  type: string,
  body: string,
  csp?: string
): void {
  res.writeHead(status, {
    'content-type': type,
    'content-security-policy': csp ?? "default-src 'none'",
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(body)
}