import { execFile } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

export interface VideoMeta {
  duration?: number
  width?: number
  height?: number
  codec?: string
  fps?: number
}

function parseDuration(s: string): number | undefined {
  const m = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!m) return undefined
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function parseDims(s: string): { width?: number; height?: number } {
  const m = s.match(/Video:.*?(\d{2,5})x(\d{2,5})/)
  if (!m) return {}
  return { width: Number(m[1]), height: Number(m[2]) }
}

/** 编码名(h264/hevc/prores/vp9/av1/mpeg4…),取 Video: 后首个 token */
function parseCodec(s: string): string | undefined {
  const m = s.match(/Video:\s*([a-z0-9_]+)/i)
  return m?.[1]?.toLowerCase()
}

function parseFps(s: string): number | undefined {
  const m = s.match(/([\d.]+)\s*fps/i)
  if (!m) return undefined
  const v = Number(m[1])
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined
}

/** 经 ffmpeg -i 解析视频时长/分辨率/编码/帧率(解析失败返回空对象,不抛错) */
export function probeVideo(absPath: string): Promise<VideoMeta> {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath as string,
      ['-i', absPath, '-f', 'null', '-'],
      { timeout: 15000, maxBuffer: 1024 * 256 },
      (_err, _stdout, stderr) => {
        const out = stderr?.toString() ?? ''
        const duration = parseDuration(out)
        const dims = parseDims(out)
        resolve({ duration, ...dims, codec: parseCodec(out), fps: parseFps(out) })
      }
    )
  })
}

/** 供单测:纯文本解析 */
export function parseVideoMetaText(stderr: string): VideoMeta {
  return {
    duration: parseDuration(stderr),
    ...parseDims(stderr),
    codec: parseCodec(stderr),
    fps: parseFps(stderr)
  }
}
