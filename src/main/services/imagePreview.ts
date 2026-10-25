import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import type { AssetFormat } from '../../shared/formats'
import { fileExists } from './cacheFiles'
import { decodeThumbnailSource } from './thumbnailDecoder'

const active = new Map<string, Promise<string>>()
const PREVIEW_MAX_EDGE = 2400

export function imagePreviewDir(libPath: string): string {
  return join(libPath, '.mediahub', 'previews', 'images')
}

export function imagePreviewPath(libPath: string, fingerprint: string): string {
  return join(imagePreviewDir(libPath), `${fingerprint}.jpg`)
}

/** PSD/HEIC 不能直接交给 Chromium；缓存一张 2400px 内的大图供灯箱使用。 */
export function ensureImagePreview(
  libPath: string,
  absPath: string,
  fingerprint: string,
  format: Extract<AssetFormat, 'PSD' | 'HEIC'>
): Promise<string> {
  if (!/^[0-9a-f]{20}$/i.test(fingerprint)) return Promise.reject(new Error('invalid fingerprint'))
  const target = imagePreviewPath(libPath, fingerprint)
  const running = active.get(target)
  if (running) return running

  const task = (async () => {
    if (await fileExists(target)) return target
    const source = await decodeThumbnailSource(format, absPath)
    await mkdir(imagePreviewDir(libPath), { recursive: true })
    const temp = `${target}.tmp-${process.pid}-${Date.now()}.jpg`
    try {
      await sharp(source)
        .rotate()
        .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(temp)
      await rename(temp, target)
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
    if ((await stat(target)).size === 0) throw new Error('image preview is empty')
    return target
  })()

  active.set(target, task)
  void task.finally(() => {
    if (active.get(target) === task) active.delete(target)
  }).catch(() => undefined)
  return task
}

export function resetImagePreviewTasks(): void {
  active.clear()
}
