import { ensureThumb, hasThumbIn, thumbPathIn } from './thumbs'
import { fileExists } from './cacheFiles'
import { findByFingerprint } from './libResolve'
import { send } from '../events'

/** 指纹跨库查找 + 按命中资产的实际缓存路径生成;完成后广播 thumbs:ready */
export function ensureThumbByFingerprint(fingerprint: string, fallbackThumbsDir?: string): boolean {
  const hit = findByFingerprint(fingerprint, fallbackThumbsDir)
  if (!hit) return false
  void ensureThumb({
    fingerprint,
    absPath: hit.absPath,
    type: hit.type,
    format: hit.format,
    targetPath: hit.thumbPath
  }).then(async (r) => {
    send('thumbs:ready', { fingerprint })
    const row = hit.db.prepare('SELECT palette, type FROM assets WHERE id = ?').get(hit.assetId) as { palette: string; type: string } | undefined
    if (row && row.type === 'image' && !r.placeholder && row.palette === '[]') {
      const { extractPaletteFromThumb } = await import('./palette')
      const { updateAsset } = await import('./store')
      const palette = await extractPaletteFromThumb(r.path).catch(() => [])
      if (palette.length > 0) {
        updateAsset(hit.db, hit.assetId, { palette: JSON.stringify(palette) })
        send('thumbs:ready', { fingerprint })
      }
    }
    if (hit.sidecarPath && hit.sourceRelPath) {
      const { assetById } = await import('./store')
      const { writeIndexSidecar } = await import('./indexCache')
      const asset = assetById(hit.db, hit.libraryId, hit.assetId)
      if (asset) await writeIndexSidecar(hit.sidecarPath, asset, hit.sourceRelPath)
    }
  }).catch(() => undefined)
  return true
}

export { fileExists, hasThumbIn, thumbPathIn }
