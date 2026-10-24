import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { THUMB_CACHE_VERSION, THUMB_SIZE } from '../src/shared/thumbnailConfig'
import {
  MODEL_THUMB_RENDERER,
  ensureThumb,
  flushManifest,
  resetThumbCache,
  thumbManifestPath,
  thumbPath,
  thumbsDir
} from '../src/main/services/thumbs'

vi.mock('../src/main/services/modelThumb', () => ({
  renderModelThumbJpeg: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
}))

describe('model thumbnail renderer version', () => {
  let root = ''

  beforeEach(async () => {
    resetThumbCache()
    root = await mkdtemp(join(tmpdir(), 'mediahub-model-version-'))
    await mkdir(thumbsDir(root), { recursive: true })
  })

  afterEach(async () => {
    resetThumbCache()
    await rm(root, { recursive: true, force: true })
  })

  it('rebuilds a 3D cover written before the renderer version was recorded', async () => {
    const fingerprint = 'fp-pmx'
    const source = join(root, 'model.pmx')
    const target = thumbPath(root, fingerprint)
    await writeFile(source, 'pmx')
    await writeFile(target, 'old-cover')
    await writeFile(thumbManifestPath(root), JSON.stringify({
      version: THUMB_CACHE_VERSION,
      size: THUMB_SIZE,
      format: 'jpeg',
      entries: {
        [fingerprint]: {
          relPath: 'model.pmx',
          mtimeMs: 1,
          sizeBytes: 3,
          libraryId: 1,
          generatedAt: '2026-10-24T00:00:00.000Z'
        }
      }
    }))
    resetThumbCache()

    await ensureThumb(root, source, fingerprint, 'PMX', {
      relPath: 'model.pmx',
      mtimeMs: 1,
      sizeBytes: 3,
      libraryId: 1
    })

    expect(await readFile(target)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    await flushManifest(root)
    const manifest = JSON.parse(await readFile(thumbManifestPath(root), 'utf8'))
    expect(manifest.entries[fingerprint].renderer).toBe(MODEL_THUMB_RENDERER)
  })
})
