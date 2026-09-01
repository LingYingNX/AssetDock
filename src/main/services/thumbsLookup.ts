import { getDb } from './db'
import { ensureThumb, hasThumb, thumbPath } from './thumbs'
import { send } from '../events'
import { join } from 'node:path'

/** 指纹 → 素材(取首个未缺失同内容文件)生成缩略图 */
export function lookupByFingerprint(
  fingerprint: string
): { absPath: string; type: 'image' | 'video' | 'model'; format: string } | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT a.rel_path, a.type, a.format, l.path AS root
       FROM assets a JOIN libraries l ON l.id = a.library_id
       WHERE a.fingerprint = ? AND a.missing = 0
       LIMIT 1`
    )
    .get(fingerprint) as { rel_path: string; type: 'image' | 'video' | 'model'; format: string; root: string } | undefined
  if (!row) return null
  return { absPath: join(row.root, row.rel_path), type: row.type, format: row.format }
}

/** 缩略图缺失时排队生成;完成后广播 thumbs:ready。返回是否成功排队 */
export function ensureThumbByFingerprint(fingerprint: string): boolean {
  const meta = lookupByFingerprint(fingerprint)
  if (!meta) return false
  void ensureThumb({ fingerprint, absPath: meta.absPath, type: meta.type, format: meta.format }).then(async (r) => {
    send('thumbs:ready', { fingerprint })
    // 顺带补调色板(仅图片)
    const db = getDb()
    const row = db.prepare('SELECT id, palette, type FROM assets WHERE fingerprint = ?').get(fingerprint) as { id: number; palette: string; type: string } | undefined
    if (row && row.type === 'image' && !r.placeholder && row.palette === '[]') {
      const { extractPaletteFromThumb } = await import('./palette')
      const { updateAsset } = await import('./store')
      const palette = await extractPaletteFromThumb(r.path).catch(() => [])
      if (palette.length > 0) {
        updateAsset(db, row.id, { palette: JSON.stringify(palette) })
        send('thumbs:ready', { fingerprint })
      }
    }
  })
  return true
}

export { hasThumb, thumbPath }
