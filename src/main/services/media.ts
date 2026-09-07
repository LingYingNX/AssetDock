import { protocol } from 'electron'
import { createReadStream, promises as fsp } from 'node:fs'
import { Readable } from 'node:stream'
import { join, extname } from 'node:path'
import { libScopeDb, realPathWithinRoot, registryLib, sourceRelativePath } from './libResolve'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.psd': 'image/vnd.adobe.photoshop',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.glb': 'model/gltf-binary',
  '.fbx': 'application/octet-stream', '.obj': 'text/plain'
}

/**
 * media://<libraryId>/<encodeURIComponent(relPath)>?source=<sourceIndexId>
 * 索引素材按 sourceIndexId 解析;realpath + relative 防越界;支持 Range(视频拖动)。
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
      const scope = libScopeDb(libId)
      if (!scope) return new Response('forbidden', { status: 403 })
      const sourceParam = u.searchParams.get('source')
      const sourceIndexId = sourceParam == null ? null : Number(sourceParam)
      let root = lib.path
      let sourceRel = rel
      if (sourceIndexId != null) {
        if (!Number.isInteger(sourceIndexId) || sourceIndexId < 1) return new Response('forbidden', { status: 403 })
        const index = scope.db.prepare('SELECT path FROM index_sources WHERE id = ?').get(sourceIndexId) as { path: string } | undefined
        sourceRel = sourceRelativePath(rel, sourceIndexId) ?? ''
        if (!index || !sourceRel) return new Response('forbidden', { status: 403 })
        root = index.path
      } else if (rel.startsWith('@index:')) {
        return new Response('forbidden', { status: 403 })
      }
      const abs = join(root, sourceRel)
      const realAbs = await realPathWithinRoot(root, abs)
      if (!realAbs) {
        return new Response('forbidden', { status: 403 })
      }
      const st = await fsp.stat(realAbs).catch(() => null)
      if (!st || !st.isFile()) return new Response('not found', { status: 404 })
      const type = MIME[extname(realAbs).toLowerCase()] ?? 'application/octet-stream'
      const range = request.headers.get('range')
      if (range) {
        const m = range.match(/bytes=(\d*)-(\d*)/)
        const total = st.size
        let start = m?.[1] ? Number(m[1]) : 0
        let end = m?.[2] ? Number(m[2]) : total - 1
        if (Number.isNaN(start) || start >= total) start = 0
        if (end >= total) end = total - 1
        const stream = createReadStream(realAbs, { start, end })
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            'content-type': type,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${total}`,
            'accept-ranges': 'bytes'
          }
        })
      }
      const stream = createReadStream(realAbs)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: { 'content-type': type, 'content-length': String(st.size), 'accept-ranges': 'bytes' }
      })
    } catch (e) {
      return new Response('error: ' + String(e), { status: 500 })
    }
  })
}
