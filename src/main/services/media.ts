import { protocol } from 'electron'
import { createReadStream, promises as fsp } from 'node:fs'
import { Readable } from 'node:stream'
import { join, extname } from 'node:path'
import { libScopeDb, realPathWithinRoot, registryLib } from './libResolve'
import { ensureThumb } from './thumbs'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.psd': 'image/vnd.adobe.photoshop',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.glb': 'model/gltf-binary',
  '.fbx': 'application/octet-stream', '.obj': 'text/plain',
  // CSS 素材及其同名预览骨架经协议读取:必须是文本类型,否则 Chromium 会当二进制处理
  '.css': 'text/css', '.html': 'text/html', '.htm': 'text/html', '.txt': 'text/plain'
}

/** 扩展名 → MIME;未知扩展名按二进制流处理(纯函数,便于测试) */
export function mimeForExtension(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** 只有位图能生成缩略图;PSD/SVG 交给占位图路径,视频仍走原文件首帧 */
const THUMBABLE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.psd'])

function serveFile(path: string, type: string, immutable: boolean, size?: number): Response {
  const headers: Record<string, string> = {
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
      const u = new URL(request.url)
      const libId = Number(u.hostname)
      const rel = decodeURIComponent(u.pathname).replace(/^\//, '')
      const lib = registryLib(libId)
      if (!lib || !rel || rel.includes('..')) {
        return new Response('forbidden', { status: 403 })
      }
      const abs = join(lib.path, rel)
      const realPath = await realPathWithinRoot(lib.path, abs)
      if (!realPath) {
        return new Response('forbidden', { status: 403 })
      }
      const st = await fsp.stat(realPath).catch(() => null)
      if (!st || !st.isFile()) return new Response('not found', { status: 404 })

      const ext = extname(realPath).toLowerCase()
      const fingerprint = u.searchParams.get('v') ?? ''

      if (u.searchParams.get('thumb') === '1' && fingerprint) {
        // 回收站素材的缩略图已随删除清理;此处不再懒生成,直接回原图,避免把刚删掉的缓存写回来
        const scope = libScopeDb(libId)
        const trashed = scope
          ? !!scope.db.prepare('SELECT 1 FROM assets WHERE library_id = ? AND rel_path = ? AND deleted_at IS NOT NULL LIMIT 1').get(libId, rel)
          : false
        if (!trashed) {
          // 位图直接缩放;PSD/SVG 等无法解码的格式由 ensureThumb 生成占位图。
          // 视频与三维不传 thumb=1(播放/渲染必须用原文件),因此不会走到这里。
          const meta = { relPath: rel, mtimeMs: st.mtimeMs, sizeBytes: st.size }
          const format = ext.slice(1).toUpperCase()
          // CSS 封面由配套 HTML 决定外观,把 HTML 摘要一并作为缓存依据
          // 动态导入:cssThumb 顶层依赖 electron,不能在模块加载期把它拉进依赖图
          const look = format === 'CSS'
            ? await import('./cssThumb').then((m) => m.resolveShellSignature(lib.path, realPath))
            : ''
          const result = await ensureThumb(lib.path, realPath, fingerprint, format, meta, look)
          const cached = await fsp.stat(result.path).catch(() => null)
          if (cached?.isFile()) {
            return serveFile(result.path, 'image/jpeg', true, cached.size)
          }
          // 生成失败(极端情况)时静默回退原图,不阻塞网格
        }
      }
      const type = mimeForExtension(ext)
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
        const m = range.match(/bytes=(\d*)-(\d*)/)
        const total = st.size
        let start = m?.[1] ? Number(m[1]) : 0
        let end = m?.[2] ? Number(m[2]) : total - 1
        if (Number.isNaN(start) || start >= total) start = 0
        if (end >= total) end = total - 1
        const stream = createReadStream(realPath, { start, end })
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            'content-type': type,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${total}`,
            'accept-ranges': 'bytes',
            ...cacheHeaders
          }
        })
      }
      return serveFile(realPath, type, versioned, st.size)
    } catch (e) {
      return new Response('error: ' + String(e), { status: 500 })
    }
  })
}
