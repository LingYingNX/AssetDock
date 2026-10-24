import { protocol } from 'electron'
import { createReadStream, promises as fsp } from 'node:fs'
import { Readable } from 'node:stream'
import { join, extname } from 'node:path'
import { libScopeDb, realPathWithinRoot, registryLib, libScopeRelease } from './libResolve'
import { inlinePlaceholderSvg, thumbPath, warmThumbInBackground } from './thumbs'
import { send } from '../events'
import { detectFormat } from '../../shared/formats'
import { transcodePath } from './transcode'
import { blendPreviewPath } from './externalPreview'
import { ensureAiPagePreview } from './aiPreview'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.psd': 'image/vnd.adobe.photoshop',
  '.ai': 'application/pdf', '.heic': 'image/heic', '.heif': 'image/heic',
  '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.tga': 'image/x-tga',
  '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv', '.wmv': 'video/x-ms-wmv', '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg', '.ts': 'video/mp2t',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.vrm': 'model/gltf-binary',
  '.fbx': 'application/octet-stream', '.obj': 'text/plain', '.mtl': 'text/plain',
  '.stl': 'model/stl', '.ply': 'application/octet-stream', '.3ds': 'application/octet-stream',
  '.dae': 'model/vnd.collada+xml', '.usdz': 'model/vnd.usdz+zip',
  '.3mf': 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  '.amf': 'application/x-amf', '.vrml': 'model/vrml', '.wrl': 'model/vrml',
  '.blend': 'application/octet-stream', '.c4d': 'application/octet-stream',
  // CSS 素材及其同名预览骨架经协议读取:必须是文本类型,否则 Chromium 会当二进制处理
  '.css': 'text/css', '.html': 'text/html', '.htm': 'text/html', '.txt': 'text/plain'
}

const CORS_HEADERS = { 'access-control-allow-origin': '*' }

/** 扩展名 → MIME;未知扩展名按二进制流处理(纯函数,便于测试) */
export function mimeForExtension(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 解析 HTTP Range 头为流式读取的 [start, end](含端)。
 * 返回 null 表示区间不可满足,由协议层转成 416。
 */
export function parseRangeHeader(range: string, total: number): { start: number; end: number } | null {
  if (!Number.isSafeInteger(total) || total <= 0) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null

  if (m[1] === '') {
    const suffix = Number(m[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, total - suffix), end: total - 1 }
  }

  const start = Number(m[1])
  const end = m[2] === '' ? total - 1 : Number(m[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= total || end < start) return null
  return { start, end: Math.min(end, total - 1) }
}

/** 缩略图缓存参数只接受内容指纹,不能把任意字符串拼进缓存路径。 */
export function isValidThumbFingerprint(value: string): boolean {
  return /^[0-9a-f]{20}$/i.test(value)
}

/**
 * media:// 的 host 是库 id。standard 模式下 WHATWG URL 会把纯数字 host
 * 规范成 IPv4(media://1/ → 0.0.0.1),这里把两种形式都还原成库 id。
 */
export function hostToLibId(host: string): number {
  if (/^\d+$/.test(host)) return Number(host)
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return NaN
  return parts.reduce((acc, n) => acc * 256 + n, 0)
}

/**
 * media:// 请求来源校验(S0-1)。只放行应用自身发起的请求:
 *  1. 生产环境主文档（file://）
 *  2. dev server 主文档（http://localhost:5173）
 *  3. Electron 内部 origin（app://、about: 等,理论上不出现,保守放行）
 * 渲染层任何被注入的外部内容（http/https 页面）fetch media:// 一律拒绝。
 * 纯函数,便于单测;referrer 取不到（空串）视为可疑,拒绝。
 */
export function isAllowedMediaReferrer(referrer: string): boolean {
  if (referrer === '') return false
  try {
    const r = new URL(referrer)
    if (r.protocol === 'file:') return true
    // Electron 内部页面(app://、about: 等)按自身 origin 放行
    if (r.protocol !== 'http:' && r.protocol !== 'https:') return true
    // electron-vite 在 5173 被占用时会换端口，允许当前开发主文档的精确 origin。
    const devOrigin = process.env.ELECTRON_RENDERER_URL
      ? new URL(process.env.ELECTRON_RENDERER_URL).origin
      : 'http://localhost:5173'
    return r.origin === devOrigin
  } catch {
    return false
  }
}

function serveFile(path: string, type: string, immutable: boolean, size?: number): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'content-type': type,
    'accept-ranges': 'bytes',
    // 缩略图文件名即指纹,天然内容寻址;带指纹的原图 URL 同理
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate'
  }
  if (size != null) headers['content-length'] = String(size)
  const stream = createReadStream(path)
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers })
}

/**
 * media://<libraryId>/<encodeURIComponent(relPath)>
 *
 * 只读取资源库内的原始素材,支持 Range(视频拖动)。
 * 带 ?thumb=1 时返回库内缩略图缓存(<库>/.mediahub/thumbs/<fingerprint>.jpg),
 * 首次请求懒生成;原图移动或改名后指纹不变,缩略图继续有效。
 */
export function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    try {
      // S0-1:来源校验——referrer 非应用自身 origin/file: 的请求直接拒绝,
      // 防注入内容借 media:// 协议静默拉取全库素材
      if (!isAllowedMediaReferrer(request.referrer ?? '')) {
        return new Response('forbidden', { status: 403 })
      }
      const parsed = /^media:\/\/([^/]+)\/([^?]*)(?:\?(.*))?$/.exec(request.url)
      const libId = hostToLibId(parsed?.[1] ?? '')
      const rel = decodeURIComponent(parsed?.[2] ?? '')
      const params = new URLSearchParams(parsed?.[3] ?? '')
      const lib = registryLib(libId)
      if (!lib || !rel || rel.includes('..')) {
        return new Response('forbidden', { status: 403 })
      }
      const abs = join(lib.path, rel)
      let realPath = await realPathWithinRoot(lib.path, abs)
      if (!realPath) {
        return new Response('forbidden', { status: 403 })
      }
      let st = await fsp.stat(realPath).catch(() => null)
      if (!st || !st.isFile()) return new Response('not found', { status: 404 })

      const ext = extname(realPath).toLowerCase()
      const fingerprint = params.get('v') ?? ''
      const thumbRequested = params.get('thumb') === '1'
      const transcodeRequested = params.get('transcoded') === '1'
      const blendRequested = params.get('blend') === '1'
      const aiPageRequested = params.get('aiPage') === '1'
      const aiPage = Number(params.get('page') ?? '1')

      if ((thumbRequested || transcodeRequested || blendRequested || aiPageRequested) && !isValidThumbFingerprint(fingerprint)) {
        return new Response('forbidden', { status: 403 })
      }

      if (transcodeRequested) {
        realPath = transcodePath(lib.path, fingerprint)
        const cached = await fsp.stat(realPath).catch(() => null)
        if (!cached?.isFile()) return new Response('not found', { status: 404 })
        st = cached
      }
      if (blendRequested) {
        realPath = blendPreviewPath(lib.path, fingerprint)
        const cached = await fsp.stat(realPath).catch(() => null)
        if (!cached?.isFile()) return new Response('not found', { status: 404 })
        st = cached
      }
      if (aiPageRequested) {
        if (!Number.isInteger(aiPage) || aiPage < 1 || aiPage > 1000) {
          return new Response('invalid page', { status: 400 })
        }
        realPath = await ensureAiPagePreview(lib.path, realPath, fingerprint, aiPage)
        st = await fsp.stat(realPath)
      }

      if (thumbRequested) {
        // 回收站素材的缩略图已随删除清理;此处不再懒生成,直接回原图,避免把刚删掉的缓存写回来
        const scope = libScopeDb(libId)
        let trashed = false
        try {
          trashed = scope
            ? !!scope.db.prepare('SELECT 1 FROM assets WHERE library_id = ? AND rel_path = ? AND deleted_at IS NOT NULL LIMIT 1').get(libId, rel)
            : false
        } finally {
          libScopeRelease(scope)
        }
        if (!trashed) {
          // 缩略图请求与生成解耦(S1-8):命中缓存直接回;miss 立即回占位 SVG,
          // 生成转后台并发池,完成后 thumbs:progress 通知渲染层重取该图。
          // 三维模型传 thumb=1 时也在此路由；不支持离屏渲染的格式会得到可缓存占位图。
          const thumbFile = thumbPath(lib.path, fingerprint)
          const cached = await fsp.stat(thumbFile).catch(() => null)
          if (cached?.isFile()) {
            return serveFile(thumbFile, 'image/jpeg', true, cached.size)
          }
          const meta = { relPath: rel, mtimeMs: st.mtimeMs, sizeBytes: st.size, libraryId: libId }
          const format = detectFormat(rel)?.format ?? ext.slice(1).toUpperCase()
          // CSS 封面由配套 HTML 决定外观,把 HTML 摘要一并作为缓存依据
          // 动态导入:cssThumb 顶层依赖 electron,不能在模块加载期把它拉进依赖图
          const look = format === 'CSS'
            ? await import('./cssThumb').then((m) => m.resolveShellSignature(lib.path, realPath))
            : ''
          const libraryId = libId
          warmThumbInBackground(lib.path, realPath, fingerprint, format, meta, look, () => {
            send('thumbs:progress', { libraryId, done: 0, total: 0, phase: 'done', fingerprint })
          })
          return new Response(inlinePlaceholderSvg(format), {
            status: 200,
            headers: { ...CORS_HEADERS, 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }
          })
        }
      }
      const type = transcodeRequested
        ? 'video/mp4'
        : blendRequested
          ? 'model/gltf-binary'
          : aiPageRequested
            ? 'image/jpeg'
          : mimeForExtension(ext)
      // 预览 URL 带指纹版本参数(?v=),内容变化即换 URL,可安全长缓存:
      // 切换文件夹时命中 Chromium 缓存而非重下整张原图。无指纹时用 last-modified 兜底。
      const versioned = fingerprint !== ''
      const cacheHeaders: Record<string, string> = {
        'last-modified': st.mtime.toUTCString(),
        'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate'
      }
      if (versioned) cacheHeaders.etag = `"${fingerprint}"`

      const range = request.headers.get('range')
      if (range) {
        const total = st.size
        const parsed = parseRangeHeader(range, total)
        if (!parsed) {
          return new Response('range not satisfiable', {
            status: 416,
            headers: { 'content-range': `bytes */${total}` }
          })
        }
        const { start, end } = parsed
        const stream = createReadStream(realPath, { start, end })
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            ...CORS_HEADERS,
            'content-type': type,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${total}`,
            'accept-ranges': 'bytes',
            ...cacheHeaders
          }
        })
      }
      return serveFile(realPath, type, versioned, st.size)
    } catch {
      // 细节只进主进程日志;协议响应不回显异常文本,防渲染层被注入后借 500 响应探测内部路径/SQL
      console.error('[media] protocol handler error')
      return new Response('internal error', { status: 500 })
    }
  })
}
