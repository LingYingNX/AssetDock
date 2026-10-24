import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { detectFormat } from '../../shared/formats'
import { probeVideo } from './videoMeta'

export interface ImageProbe {
  width?: number
  height?: number
}

/**
 * 图片元数据探测路由。任何解析器失败都返回空对象，扫描不能因单个文件中断。
 */
export async function probeImageMeta(absPath: string, relPath: string): Promise<ImageProbe> {
  const spec = detectFormat(relPath)
  if (!spec || spec.type !== 'image') return {}

  try {
    if (spec.probe === 'sharp') {
      const meta = await sharp(absPath).metadata()
      return { width: meta.width, height: meta.height }
    }
    if (spec.probe === 'psd') return await probePsd(absPath)
    if (spec.probe === 'pdf') return await probePdf(absPath)
    if (spec.probe === 'heic') return await probeHeic(absPath)
    if (spec.probe === 'ffmpeg') {
      const meta = await probeVideo(absPath)
      return { width: meta.width, height: meta.height }
    }
  } catch {
    // 探测失败保留空字段；缩略图阶段会给出更具体的失败类别。
  }
  return {}
}

async function probePsd(absPath: string): Promise<ImageProbe> {
  const { readPsd } = await import('ag-psd')
  const psd = readPsd(await readFile(absPath), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true
  })
  return { width: psd.width, height: psd.height }
}

async function probePdf(absPath: string): Promise<ImageProbe> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await readFile(absPath))
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true
  })
  const doc = await task.promise
  try {
    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    return { width: Math.round(viewport.width), height: Math.round(viewport.height) }
  } finally {
    await doc.cleanup()
    await task.destroy()
  }
}

async function probeHeic(absPath: string): Promise<ImageProbe> {
  const heicConvert = (await import('heic-convert')).default
  const jpeg = await heicConvert({ buffer: await readFile(absPath), format: 'JPEG', quality: 0.8 })
  const meta = await sharp(Buffer.from(jpeg)).metadata()
  return { width: meta.width, height: meta.height }
}
