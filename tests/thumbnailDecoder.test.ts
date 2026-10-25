import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createThumbnailJpeg,
  decodeThumbnailSourceWith,
  hdrToneMapFilter,
  ThumbnailDecodeError,
  type ThumbnailDecoders
} from '../src/main/services/thumbnailDecoder'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mediahub-thumb-decode-'))
  roots.push(root)
  return root
}

function runFfmpeg(args: string[]): void {
  execFileSync(ffmpegPath as string, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    timeout: 30_000,
    windowsHide: true
  })
}

async function writePng(path: string): Promise<void> {
  const png = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 220, g: 70, b: 35 } }
  }).png().toBuffer()
  await writeFile(path, png)
}

function minimalPdf(): Buffer {
  const stream = 'BT /F1 24 Tf 20 50 Td (AI preview) Tj ET'
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 0; i < bodies.length; i++) {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${bodies[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('routed thumbnail decoding', () => {
  const decoders = (patch: Partial<ThumbnailDecoders>): ThumbnailDecoders => ({
    sharp: async () => Buffer.from('sharp'),
    heic: async () => Buffer.from('heic'),
    psd: async () => Buffer.from('psd'),
    pdf: async () => Buffer.from('pdf'),
    ffmpeg: async () => Buffer.from('ffmpeg'),
    ...patch
  })

  it('uses native sharp and never starts ffmpeg when sharp succeeds', async () => {
    const root = await tempRoot()
    const sample = join(root, 'sample.png')
    await writePng(sample)
    const ffmpeg = vi.fn(async () => Buffer.from('ffmpeg'))

    const result = await decodeThumbnailSourceWith('PNG', sample, decoders({
      sharp: async () => Buffer.from('sharp'),
      ffmpeg
    }))
    expect(result.toString()).toBe('sharp')
    expect(ffmpeg).not.toHaveBeenCalled()
  })

  it('falls back to ffmpeg only after native sharp fails', async () => {
    const root = await tempRoot()
    const sample = join(root, 'sample.png')
    await writePng(sample)
    const sharpDecoder = vi.fn(async () => { throw new Error('unsupported profile') })
    const ffmpeg = vi.fn(async () => Buffer.from('ffmpeg'))

    const result = await decodeThumbnailSourceWith('PNG', sample, decoders({
      sharp: sharpDecoder,
      ffmpeg
    }))
    expect(result.toString()).toBe('ffmpeg')
    expect(sharpDecoder).toHaveBeenCalledTimes(1)
    expect(ffmpeg).toHaveBeenCalledTimes(1)
  })

  it('reports a typed failure when every video decode level fails', async () => {
    const root = await tempRoot()
    const sample = join(root, 'broken.mp4')
    await writeFile(sample, 'broken')
    const ffmpeg = vi.fn(async () => { throw new Error('decode failed') })

    await expect(decodeThumbnailSourceWith('MP4', sample, decoders({ ffmpeg })))
      .rejects.toBeInstanceOf(ThumbnailDecodeError)
    expect(ffmpeg).toHaveBeenCalledTimes(2)
  })

  it('retries the first decodable frame when the keyframe pass fails', async () => {
    const root = await tempRoot()
    const sample = join(root, 'sample.mkv')
    await writeFile(sample, 'video')
    const ffmpeg = vi.fn(async (_path: string, _filter: string, keyframeOnly?: boolean) => {
      if (keyframeOnly) throw new Error('bad keyframe')
      return Buffer.from('first frame')
    })

    const result = await decodeThumbnailSourceWith('MKV', sample, decoders({ ffmpeg }))
    expect(result.toString()).toBe('first frame')
    expect(ffmpeg.mock.calls.map((call) => call[2])).toEqual([true, undefined])
  })

  it.each([
    { format: 'BMP' as const, ext: 'bmp', args: (src: string, out: string) => ['-i', src, out] },
    {
      format: 'ICO' as const,
      ext: 'ico',
      args: (src: string, out: string) => ['-i', src, '-vf', 'scale=128:128', out]
    },
    { format: 'TGA' as const, ext: 'tga', args: (src: string, out: string) => ['-i', src, out] },
    { format: 'EXR' as const, ext: 'exr', args: (src: string, out: string) => ['-i', src, '-pix_fmt', 'gbrpf32le', out] },
    { format: 'HDR' as const, ext: 'hdr', args: (src: string, out: string) => ['-i', src, '-pix_fmt', 'gbrpf32le', out] },
    {
      format: 'MP4' as const,
      ext: 'mp4',
      args: (_src: string, out: string) => [
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10', '-t', '0.4',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out
      ]
    },
    {
      format: 'MKV' as const,
      ext: 'mkv',
      args: (_src: string, out: string) => [
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10', '-t', '0.4',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out
      ]
    }
  ])('decodes $format to a 640px JPEG', async ({ format, ext, args }) => {
    const root = await tempRoot()
    const source = join(root, 'source.png')
    const sample = join(root, `sample.${ext}`)
    await writePng(source)
    runFfmpeg(args(source, sample))

    const jpeg = await createThumbnailJpeg(format, sample)
    const meta = await sharp(jpeg).metadata()
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(640)
  }, 30_000)

  it.each([
    { format: 'AVIF' as const, ext: 'avif' },
    { format: 'TIFF' as const, ext: 'tiff' }
  ])('decodes $format through sharp', async ({ format, ext }) => {
    const root = await tempRoot()
    const source = join(root, 'source.png')
    const sample = join(root, `sample.${ext}`)
    await writePng(source)
    const input = await sharp(source)
    if (format === 'AVIF') await input.avif().toFile(sample)
    else await input.tiff().toFile(sample)

    const jpeg = await createThumbnailJpeg(format, sample)
    expect((await sharp(jpeg).metadata()).format).toBe('jpeg')
  })

  it('renders the first page of a PDF-compatible AI file', async () => {
    const root = await tempRoot()
    const sample = join(root, 'poster.ai')
    await writeFile(sample, minimalPdf())

    const jpeg = await createThumbnailJpeg('AI', sample)
    const meta = await sharp(jpeg).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBeGreaterThan(0)
    expect(meta.height).toBeGreaterThan(0)
  })

  it('renders a PSD composite image', async () => {
    const root = await tempRoot()
    const sample = join(root, 'art.psd')
    const [{ createCanvas }, { initializeCanvas, writePsdBuffer }] = await Promise.all([
      import('@napi-rs/canvas'),
      import('ag-psd')
    ])
    initializeCanvas(createCanvas as never)
    const canvas = createCanvas(160, 90)
    const context = canvas.getContext('2d')
    context.fillStyle = '#2f7bd8'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#f5c542'
    context.fillRect(20, 20, 60, 30)
    await writeFile(sample, writePsdBuffer({
      width: canvas.width,
      height: canvas.height,
      canvas: canvas as never
    }))

    const jpeg = await createThumbnailJpeg('PSD', sample)
    const meta = await sharp(jpeg).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(160)
    expect(meta.height).toBe(90)
  })

  it('rejects corrupt sources with a typed failure category', async () => {
    const root = await tempRoot()
    const sample = join(root, 'broken.psd')
    await writeFile(sample, 'not a psd')

    await expect(createThumbnailJpeg('PSD', sample)).rejects.toBeInstanceOf(ThumbnailDecodeError)
  })

  it('renders a PSD that only has layer pixels, without a saved composite', async () => {
    const root = await tempRoot()
    const sample = join(root, 'layers-only.psd')
    const [{ createCanvas }, { initializeCanvas, writePsdBuffer }] = await Promise.all([
      import('@napi-rs/canvas'),
      import('ag-psd')
    ])
    initializeCanvas(createCanvas as never)
    const layer = createCanvas(40, 30)
    const context = layer.getContext('2d')
    context.fillStyle = '#12a26b'
    context.fillRect(0, 0, layer.width, layer.height)
    await writeFile(sample, writePsdBuffer({
      width: 40,
      height: 30,
      children: [{ name: 'layer', canvas: layer as never }]
    }))

    const jpeg = await createThumbnailJpeg('PSD', sample)
    const meta = await sharp(jpeg).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(40)
    expect(meta.height).toBe(30)
  })

  it('rejects an AI file that was not saved PDF-compatible', async () => {
    const root = await tempRoot()
    const sample = join(root, 'legacy.ai')
    await writeFile(sample, '%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator\nshowpage\n')

    await expect(createThumbnailJpeg('AI', sample)).rejects.toBeInstanceOf(ThumbnailDecodeError)
  })

  it('uses scene-linear tone mapping for HDR and EXR', () => {
    const filter = hdrToneMapFilter()
    expect(filter).toContain('tonemap=tonemap=hable')
    expect(filter).toContain('format=gbrpf32le')
    expect(filter).toContain('format=rgb24')
  })
})
