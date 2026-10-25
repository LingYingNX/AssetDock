import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureImagePreview,
  imagePreviewPath,
  resetImagePreviewTasks
} from '../src/main/services/imagePreview'

const roots: string[] = []
const fingerprint = '0123456789abcdef0123'

async function writePsd(path: string): Promise<void> {
  const [{ createCanvas }, { initializeCanvas, writePsdBuffer }] = await Promise.all([
    import('@napi-rs/canvas'),
    import('ag-psd')
  ])
  initializeCanvas(createCanvas as never)
  const canvas = createCanvas(900, 600)
  const context = canvas.getContext('2d')
  context.fillStyle = '#2f7bd8'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await writeFile(path, writePsdBuffer({
    width: canvas.width,
    height: canvas.height,
    canvas: canvas as never
  }))
}

afterEach(async () => {
  resetImagePreviewTasks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PSD/HEIC lightbox preview cache', () => {
  it('renders a full-size PSD composite instead of reusing the card thumbnail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-image-preview-'))
    roots.push(root)
    const source = join(root, 'art.psd')
    await writePsd(source)

    const preview = await ensureImagePreview(root, source, fingerprint, 'PSD')
    expect(preview).toBe(imagePreviewPath(root, fingerprint))
    const meta = await sharp(preview).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(900)
    expect(meta.height).toBe(600)
  })

  it('rejects a corrupt PSD instead of returning a blank cache file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-image-preview-broken-'))
    roots.push(root)
    const source = join(root, 'broken.psd')
    await writeFile(source, 'not a psd')

    await expect(ensureImagePreview(root, source, fingerprint, 'PSD')).rejects.toThrow()
  })
})
