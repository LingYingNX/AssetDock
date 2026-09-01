import { protocol } from 'electron'
import { createReadStream, promises as fsp } from 'node:fs'
import { Readable } from 'node:stream'
import { join, extname } from 'node:path'
import { getLibrary, listLibraries } from './store'
import { getLibHandle, hasLibDb } from './libraryDb'
import type { Database } from 'better-sqlite3'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.psd': 'image/vnd.adobe.photoshop',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.glb': 'model/gltf-binary',
  '.fbx': 'application/octet-stream', '.obj': 'text/plain'
}

interface LibInfo { id: number; name: string; path: string }

/** 放行根:每库根 + 其索引根(迁移前库无索引) */
function collectRoots(db: Database): string[] {
  const roots: string[] = []
  for (const lib of listLibraries(db)) {
    roots.push(lib.path)
    if (hasLibDb(lib.path)) {
      try {
        for (const idx of getLibHandle(lib.path).prepare('SELECT path FROM index_sources').all() as { path: string }[]) {
          roots.push(idx.path)
        }
      } catch { /* 单库失败不阻塞其余 */ }
    }
  }
  return roots
}

/**
 * media://<libraryId>/<encodeURIComponent(relPath)>
 * relPath 为「索引名/相对路径」时解析到索引根;realpath 前缀防穿越;支持 Range(视频拖动)。
 */
export function registerMediaProtocol(db: Database): void {
  protocol.handle('media', async (request) => {
    try {
      const u = new URL(request.url)
      const libId = Number(u.hostname)
      const rel = decodeURIComponent(u.pathname).replace(/^\//, '')
      const lib = getLibrary(db, libId)
      if (!lib || !rel || rel.includes('..')) {
        return new Response('forbidden', { status: 403 })
      }
      const idx = (() => {
        if (!hasLibDb(lib.path)) return null
        try {
          return (getLibHandle(lib.path).prepare('SELECT id, path, name FROM index_sources WHERE name = ?').get(rel.split('/')[0]) as { id: number; path: string; name: string } | undefined) ?? null
        } catch {
          return null
        }
      })()
      const abs = idx ? join(idx.path, rel.slice(idx.name.length + 1)) : join(lib.path, rel)
      const roots: string[] = []
      for (const r of [lib.path, ...(idx ? [idx.path] : []), ...collectRoots(db)]) {
        const rp = await fsp.realpath(r).catch(() => r)
        roots.push(rp.toLowerCase().replace(/\\/g, '/'))
      }
      const realAbs = await fsp.realpath(abs).catch(() => abs)
      const okRoot = roots.some((r) => realAbs.toLowerCase().replace(/\\/g, '/').startsWith(r))
      if (!okRoot) {
        return new Response('forbidden', { status: 403 })
      }
      const st = await fsp.stat(abs).catch(() => null)
      if (!st || !st.isFile()) return new Response('not found', { status: 404 })
      const type = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      const range = request.headers.get('range')
      if (range) {
        const m = range.match(/bytes=(\d*)-(\d*)/)
        const total = st.size
        let start = m?.[1] ? Number(m[1]) : 0
        let end = m?.[2] ? Number(m[2]) : total - 1
        if (Number.isNaN(start) || start >= total) start = 0
        if (end >= total) end = total - 1
        const stream = createReadStream(abs, { start, end })
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
      const stream = createReadStream(abs)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: { 'content-type': type, 'content-length': String(st.size), 'accept-ranges': 'bytes' }
      })
    } catch (e) {
      return new Response('error: ' + String(e), { status: 500 })
    }
  })
}
