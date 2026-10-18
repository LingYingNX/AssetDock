import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectOrphanThumbs,
  ensureThumb,
  flushManifest,
  pruneMissingThumbs,
  generateMissingThumbs,
  removeThumb,
  resetThumbCache,
  retargetThumb,
  thumbManifestPath,
  thumbPath,
  thumbsDir
} from '../src/main/services/thumbs'

/** 生成一张真实可解码的小 PNG 作为原图 */
async function writeImage(path: string, size = 800, color = { r: 30, g: 120, b: 200 }): Promise<void> {
  const sharp = (await import('sharp')).default
  const buf = await sharp({ create: { width: size, height: Math.round(size * 0.6), channels: 3, background: color } })
    .png()
    .toBuffer()
  await writeFile(path, buf)
}

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false)

describe('thumbnail cache', () => {
  let root = ''
  let absImage = ''
  const fingerprint = 'fp-abc'

  beforeEach(async () => {
    resetThumbCache()
    root = await mkdtemp(join(tmpdir(), 'mediahub-thumbs-'))
    absImage = join(root, 'photo.png')
    await writeImage(absImage)
  })
  afterEach(async () => {
    resetThumbCache()
    await rm(root, { recursive: true, force: true })
  })

  const meta = (relPath = 'photo.png') => ({ relPath, mtimeMs: 1, sizeBytes: 100 })

  it('generates a 640px jpg and records it in the manifest', async () => {
    const result = await ensureThumb(root, absImage, fingerprint, 'PNG', meta())
    expect(result.placeholder).toBe(false)
    expect(await exists(result.path)).toBe(true)

    const sharp = (await import('sharp')).default
    // 读进内存再解析:Windows 上 sharp 直接读文件会保持句柄,导致临时目录清理 EBUSY
    const buf = await readFile(result.path)
    const info = await sharp(buf).metadata()
    expect(info.format).toBe('jpeg')
    expect(Math.max(info.width ?? 0, info.height ?? 0)).toBeLessThanOrEqual(640)

    await flushManifest(root)
    const manifest = JSON.parse(await readFile(thumbManifestPath(root), 'utf8'))
    expect(manifest.size).toBe(640)
    expect(manifest.format).toBe('jpeg')
    expect(manifest.entries[fingerprint].relPath).toBe('photo.png')
  })

  it('reuses an existing thumbnail instead of decoding again', async () => {
    await ensureThumb(root, absImage, fingerprint, 'PNG', meta())
    await flushManifest(root)
    const first = await readFile(thumbPath(root, fingerprint))

    // 破坏原图:若仍返回同样的缩略图,说明第二次没有重新解码
    await writeFile(absImage, 'not an image anymore')
    const second = await ensureThumb(root, absImage, fingerprint, 'PNG', meta())
    expect(await readFile(second.path)).toEqual(first)
  })

  it('falls back to a placeholder when the source cannot be decoded', async () => {
    const broken = join(root, 'broken.psd')
    await writeFile(broken, 'not really a psd')
    const result = await ensureThumb(root, broken, 'fp-broken', 'PSD', meta('broken.psd'))
    expect(result.placeholder).toBe(true)
    expect(await exists(result.path)).toBe(true)
  })

  it('keeps the thumbnail after the source moves and follows the new path', async () => {
    await ensureThumb(root, absImage, fingerprint, 'PNG', meta())
    await flushManifest(root)
    const before = await readFile(thumbPath(root, fingerprint))

    await mkdir(join(root, 'sub'))
    const moved = join(root, 'sub', 'photo.png')
    const { rename } = await import('node:fs/promises')
    await rename(absImage, moved)
    await retargetThumb(root, fingerprint, 'sub/photo.png')
    await flushManifest(root)

    const after = await ensureThumb(root, moved, fingerprint, 'PNG', meta('sub/photo.png'))
    expect(await readFile(after.path)).toEqual(before)
    const manifest = JSON.parse(await readFile(thumbManifestPath(root), 'utf8'))
    expect(manifest.entries[fingerprint].relPath).toBe('sub/photo.png')
  })

  it('deletes the thumbnail and manifest entry when the source is removed', async () => {
    await ensureThumb(root, absImage, fingerprint, 'PNG', meta())
    await flushManifest(root)
    expect(await exists(thumbPath(root, fingerprint))).toBe(true)

    await removeThumb(root, fingerprint)
    expect(await exists(thumbPath(root, fingerprint))).toBe(false)
    const manifest = JSON.parse(await readFile(thumbManifestPath(root), 'utf8'))
    expect(manifest.entries[fingerprint]).toBeUndefined()
  })

  it('generates only the missing thumbs and reports progress', async () => {
    await ensureThumb(root, absImage, 'fp-a', 'PNG', { relPath: 'photo.png', mtimeMs: 1, sizeBytes: 100 })
    await flushManifest(root)
    const other = join(root, 'other.png')
    await writeImage(other, 600, { r: 200, g: 60, b: 60 })

    const seen: number[] = []
    const result = await generateMissingThumbs(
      root,
      [
        { absPath: absImage, fingerprint: 'fp-a', format: 'PNG', meta: { relPath: 'photo.png', mtimeMs: 1, sizeBytes: 100 } },
        { absPath: other, fingerprint: 'fp-b', format: 'PNG', meta: { relPath: 'other.png', mtimeMs: 2, sizeBytes: 200 } }
      ],
      (done) => seen.push(done)
    )

    expect(result.total).toBe(1)
    expect(result.generated).toBe(1)
    expect(seen[seen.length - 1]).toBe(1)
    expect(await exists(thumbPath(root, 'fp-b'))).toBe(true)
  })

  it('skips jobs whose fingerprint is already cached', async () => {
    await ensureThumb(root, absImage, fingerprint, 'PNG', meta())
    await flushManifest(root)
    const result = await generateMissingThumbs(root, [
      { absPath: absImage, fingerprint, format: 'PNG', meta: meta() }
    ])
    expect(result.total).toBe(0)
    expect(result.generated).toBe(0)
  })
  it('prunes manifest entries whose file disappeared', async () => {
    await ensureThumb(root, absImage, fingerprint, 'PNG', meta())
    await flushManifest(root)
    await rm(thumbPath(root, fingerprint), { force: true })
    expect(await pruneMissingThumbs(root)).toBe(1)
    const manifest = JSON.parse(await readFile(thumbManifestPath(root), 'utf8'))
    expect(Object.keys(manifest.entries)).toHaveLength(0)
  })

  it('collects thumbnails that are neither live nor in the manifest', async () => {
    await mkdir(thumbsDir(root), { recursive: true })
    await writeFile(thumbPath(root, 'orphan'), 'x')
    expect(await collectOrphanThumbs(root, new Set())).toBe(1)
    expect(await exists(thumbPath(root, 'orphan'))).toBe(false)
  })

  it('removes thumbnails that use an outdated naming scheme', async () => {
    await mkdir(thumbsDir(root), { recursive: true })
    // 旧版本产物:WebP 遗留 / 旧尺寸 JPG / 无尺寸后缀
    await writeFile(join(thumbsDir(root), 'legacy.webp'), 'x')
    await writeFile(join(thumbsDir(root), 'legacy-320.jpg'), 'x')

    expect(await collectOrphanThumbs(root, new Set())).toBe(2)
    expect(await exists(join(thumbsDir(root), 'legacy.webp'))).toBe(false)
    expect(await exists(join(thumbsDir(root), 'legacy-320.jpg'))).toBe(false)
  })

  it('keeps thumbnails that are still live', async () => {
    await mkdir(thumbsDir(root), { recursive: true })
    await writeFile(thumbPath(root, 'live'), 'x')
    expect(await collectOrphanThumbs(root, new Set(['live']))).toBe(0)
    expect(await exists(thumbPath(root, 'live'))).toBe(true)
  })

  it('keeps the manifest file itself when collecting orphans', async () => {
    await ensureThumb(root, absImage, fingerprint, 'PNG', meta())
    await flushManifest(root)
    await collectOrphanThumbs(root, new Set([fingerprint]))
    expect(await exists(thumbManifestPath(root))).toBe(true)
  })

  it('drops thumbnails and manifest entries that no live asset references', async () => {
    await ensureThumb(root, absImage, fingerprint, 'PNG', meta())
    await flushManifest(root)
    expect(await collectOrphanThumbs(root, new Set())).toBe(1)
    expect(await exists(thumbPath(root, fingerprint))).toBe(false)
    const manifest = JSON.parse(await readFile(thumbManifestPath(root), 'utf8'))
    expect(manifest.entries[fingerprint]).toBeUndefined()
  })
})
