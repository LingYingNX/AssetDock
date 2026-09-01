import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import sharp from 'sharp'
import ffmpegPath from 'ffmpeg-static'

let thumbsDir = join(process.env.APPDATA ?? '.', 'mediahub', 'thumbs')

export function initThumbs(userDataDir: string): void {
  thumbsDir = join(userDataDir, 'thumbs')
  void mkdir(thumbsDir, { recursive: true })
}

export function thumbPath(fingerprint: string): string {
  return join(thumbsDir, `${fingerprint}.webp`)
}

export function thumbPathIn(dir: string, fingerprint: string): string {
  return join(dir, `${fingerprint}.webp`)
}

export async function hasThumbIn(dir: string, fingerprint: string): Promise<boolean> {
  try {
    await access(thumbPathIn(dir, fingerprint))
    return true
  } catch {
    return false
  }
}

export async function hasThumb(fingerprint: string): Promise<boolean> {
  try {
    await access(thumbPath(fingerprint))
    return true
  } catch {
    return false
  }
}

/** 串行生成队列 */
let chain: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}

function ffmpegFrame(absPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath as string,
      ['-ss', '1', '-i', absPath, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'bmp', '-'],
      { timeout: 30000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout?.length) return reject(err ?? new Error('empty frame'))
        resolve(stdout as unknown as Buffer)
      }
    )
  })
}

/** 格式占位图(PSD/AI/损坏文件) */
async function placeholderWebp(label: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
    <rect width="320" height="240" fill="#B7C0CE"/>
    <rect width="320" height="240" fill="url(#g)"/>
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#E8EDF5"/><stop offset="1" stop-color="#7C8BA1"/>
    </linearGradient></defs>
    <text x="160" y="126" font-family="Segoe UI, sans-serif" font-size="30" font-weight="700"
      fill="#2C3444" text-anchor="middle">${label}</text>
  </svg>`
  return sharp(Buffer.from(svg)).webp().toBuffer()
}

export interface ThumbRequest {
  fingerprint: string
  absPath: string
  type: 'image' | 'video' | 'model'
  format: string
  /** 缓存目录(库内 .mediahub/thumbs);缺省用全局 thumbs */
  dir?: string
}

function dirOf(req: ThumbRequest): string {
  return req.dir ?? thumbsDir
}

/** 确保缩略图存在;返回缓存路径。生成串行执行,失败回退占位图。 */
export async function ensureThumb(req: ThumbRequest): Promise<{ path: string; placeholder: boolean }> {
  const target = thumbPathIn(dirOf(req), req.fingerprint)
  const exists = async (): Promise<boolean> => {
    try {
      await access(target)
      return true
    } catch {
      return false
    }
  }
  if (await exists()) return { path: target, placeholder: false }
  return enqueue(async () => {
    if (await exists()) return { path: target, placeholder: false }
    let buf: Buffer
    try {
      if (req.type === 'video') {
        const frame = await ffmpegFrame(req.absPath)
        buf = await sharp(frame).resize(320, 320, { fit: 'inside', withoutEnlargement: true }).webp().toBuffer()
      } else if (req.type === 'model') {
        buf = await placeholderWebp(req.format)
      } else {
        buf = await sharp(req.absPath)
          .rotate()
          .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
          .webp()
          .toBuffer()
      }
    } catch {
      buf = await placeholderWebp(req.format)
      await writeFile(target, buf)
      return { path: target, placeholder: true }
    }
    await writeFile(target, buf)
    return { path: target, placeholder: false }
  })
}
