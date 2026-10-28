import { readFile, stat } from 'node:fs/promises'
import sharp from 'sharp'
import { formatSpec, type AssetFormat } from '../../shared/formats'
import { MediaProcessError, runFfmpeg } from './ffmpeg'

export type ThumbnailFailureKind = 'unsupported' | 'corrupt' | 'timeout' | 'too-large' | 'missing-tool' | 'encrypted'

export class ThumbnailDecodeError extends Error {
  constructor(
    message: string,
    readonly kind: ThumbnailFailureKind
  ) {
    super(message)
    this.name = 'ThumbnailDecodeError'
  }
}

interface OutputSink {
  toBuffer: (mime: string) => Promise<Buffer> | Buffer
}

const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024
const SCALE_FILTER = 'scale=640:640:force_original_aspect_ratio=decrease'

function mapProcessError(error: unknown): unknown {
  if (!(error instanceof MediaProcessError)) return error
  return new ThumbnailDecodeError(
    error.message,
    error.kind === 'timeout' || error.kind === 'too-large' ? error.kind : 'corrupt'
  )
}

export function ffmpegImageArgs(absPath: string, filter: string, keyframeOnly = false): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    ...(keyframeOnly ? ['-skip_frame', 'nokey'] : []),
    '-i', absPath,
    '-vf', filter,
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    'pipe:1'
  ]
}

/** HDR/EXR need scene-linear tone mapping before JPEG can represent them. */
export function hdrToneMapFilter(): string {
  return [
    'format=gbrpf32le',
    'tonemap=tonemap=hable:desat=0',
    'format=rgb24',
    SCALE_FILTER
  ].join(',')
}

async function ffmpegPng(absPath: string, filter: string, keyframeOnly = false): Promise<Buffer> {
  try {
    const result = await runFfmpeg(ffmpegImageArgs(absPath, filter, keyframeOnly), {
      timeoutMs: 45_000,
      maxOutputBytes: 64 * 1024 * 1024
    })
    if (result.stdout.length === 0) throw new ThumbnailDecodeError('decoder returned an empty frame', 'corrupt')
    return result.stdout
  } catch (error) {
    throw mapProcessError(error)
  }
}

async function decodeSharp(absPath: string): Promise<Buffer> {
  return sharp(absPath).rotate().png().toBuffer()
}

async function decodeHeic(absPath: string): Promise<Buffer> {
  const convert = (await import('heic-convert')).default
  return Buffer.from(await convert({ buffer: await readFile(absPath), format: 'JPEG', quality: 0.9 }))
}

async function decodePsd(absPath: string): Promise<Buffer> {
  const [{ readPsd, initializeCanvas, getCompositeCanvas }, canvas] = await Promise.all([
    import('ag-psd'),
    import('@napi-rs/canvas')
  ])
  initializeCanvas(canvas.createCanvas as never)
  const psd = readPsd(await readFile(absPath), {
    skipLayerImageData: true,
    skipThumbnail: true
  })
  const composite = psd.canvas ?? getCompositeCanvas(psd)
  if (!composite) throw new ThumbnailDecodeError('PSD has no composite image', 'unsupported')
  return (composite as unknown as OutputSink).toBuffer('image/png')
}

export interface PdfPageRender {
  png: Buffer
  pageCount: number
}

export async function renderPdfPagePng(absPath: string, pageNumber = 1, maxEdge = 1280): Promise<PdfPageRender> {
  const [{ createCanvas }, pdfjs] = await Promise.all([
    import('@napi-rs/canvas'),
    import('pdfjs-dist/legacy/build/pdf.mjs')
  ])
  const data = new Uint8Array(await readFile(absPath))
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true
  })
  const doc = await task.promise
  try {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
      throw new ThumbnailDecodeError(`PDF page ${pageNumber} does not exist`, 'corrupt')
    }
    const page = await doc.getPage(pageNumber)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(6, Math.max(1, maxEdge / Math.max(base.width, base.height)))
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    context.save()
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.restore()
    await page.render({ canvas: canvas as never, viewport }).promise
    return { png: canvas.toBuffer('image/png'), pageCount: doc.numPages }
  } finally {
    await doc.cleanup()
    await task.destroy()
  }
}

async function decodePdf(absPath: string): Promise<Buffer> {
  return (await renderPdfPagePng(absPath)).png
}

/**
 * 解码器可注入版本只服务于路由测试:生产调用始终走默认实现,
 * 这样能断言“原生失败后才启动 ffmpeg”的顺序,又不用伪造子进程。
 */
export interface ThumbnailDecoders {
  sharp: (absPath: string) => Promise<Buffer>
  heic: (absPath: string) => Promise<Buffer>
  psd: (absPath: string) => Promise<Buffer>
  pdf: (absPath: string) => Promise<Buffer>
  ffmpeg: (absPath: string, filter: string, keyframeOnly?: boolean) => Promise<Buffer>
}

const defaultDecoders: ThumbnailDecoders = {
  sharp: decodeSharp,
  heic: decodeHeic,
  psd: decodePsd,
  pdf: decodePdf,
  ffmpeg: ffmpegPng
}

async function decodeVideo(absPath: string, ffmpeg: ThumbnailDecoders['ffmpeg']): Promise<Buffer> {
  try {
    return await ffmpeg(absPath, SCALE_FILTER, true)
  } catch (error) {
    if (error instanceof ThumbnailDecodeError && error.kind === 'timeout') throw error
    return ffmpeg(absPath, SCALE_FILTER)
  }
}

/**
 * Decode every supported raster/vector source to a normal raster buffer.
 * Callers still run sharp afterwards, so output is always the 640px JPEG contract.
 */
export async function decodeThumbnailSource(format: AssetFormat, absPath: string): Promise<Buffer> {
  return decodeThumbnailSourceWith(format, absPath, defaultDecoders)
}

/** 按注册表顺序解码;前一级失败即继续下一级,最终由调用方写失败占位。 */
export async function decodeThumbnailSourceWith(
  format: AssetFormat,
  absPath: string,
  decoders: ThumbnailDecoders
): Promise<Buffer> {
  const spec = formatSpec(format)
  if (!spec) throw new ThumbnailDecodeError(`unknown format: ${format}`, 'unsupported')
  const file = await stat(absPath).catch(() => null)
  if (!file?.isFile()) throw new ThumbnailDecodeError('source file is missing', 'corrupt')
  if (file.size > MAX_SOURCE_BYTES) throw new ThumbnailDecodeError('source file exceeds limit', 'too-large')

  try {
    if (format === 'SVG') {
      const { renderSvgPreviewPng } = await import('./cssThumb')
      return await renderSvgPreviewPng(absPath)
    }
    if (spec.thumbnail === 'sharp') {
      try {
        return await decoders.sharp(absPath)
      } catch {
        return await decoders.ffmpeg(absPath, SCALE_FILTER)
      }
    }
    if (spec.thumbnail === 'heic') {
      try {
        return await decoders.heic(absPath)
      } catch {
        return await decoders.ffmpeg(absPath, SCALE_FILTER)
      }
    }
    if (spec.thumbnail === 'psd') return await decoders.psd(absPath)
    if (spec.thumbnail === 'pdf') return await decoders.pdf(absPath)
    if (spec.thumbnail === 'ffmpeg') {
      if (spec.type === 'video') return await decodeVideo(absPath, decoders.ffmpeg)
      if (format === 'HDR' || format === 'EXR') return await decoders.ffmpeg(absPath, hdrToneMapFilter())
      return await decoders.ffmpeg(absPath, SCALE_FILTER)
    }
  } catch (error) {
    if (error instanceof ThumbnailDecodeError || error instanceof MediaProcessError) throw mapProcessError(error)
    throw new ThumbnailDecodeError(
      error instanceof Error ? error.message : 'thumbnail decoder failed',
      'corrupt'
    )
  }
  throw new ThumbnailDecodeError(`no raster decoder for ${format}`, 'unsupported')
}

export async function createThumbnailJpeg(format: AssetFormat, absPath: string): Promise<Buffer> {
  const source = await decodeThumbnailSource(format, absPath)
  return sharp(source)
    .rotate()
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer()
}
