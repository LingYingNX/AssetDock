import { getDb } from './db'
import { ensureThumb, hasThumbIn, thumbPathIn } from './thumbs'
import { findByFingerprint } from './libResolve'
import { send } from '../events'

/** 指纹跨库查找 + 按命中库的 thumbs 生成;完成后广播 thumbs:ready */
export function ensureThumbByFingerprint(fingerprint: string): boolean {
  const hit = findByFingerprint(fingerprint)
  if (!hit) return false
  void ensureThumb({
    fingerprint,
    absPath: hit.absPath,
    type: hit.type,
    format: hit.format,
    dir: hit.thumbsDir
  }).then(async (r) => {
    send('thumbs:ready', { fingerprint })
    const db = getDb()
    const row = db
      .prepare(
        `SELECT a.id, a.palette, a.type FROM assets a
         JOIN libraries l ON l.id = a.library_id
         WHERE a.fingerprint = ? AND a.missing = 0 LIMIT 1`
      )
      .get(fingerprint) as { id: number; palette: string; type: string } | undefined
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

export { hasThumbIn, thumbPathIn }
