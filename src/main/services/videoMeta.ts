import { execFile } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

export interface VideoMeta {
  duration?: number
  width?: number
  height?: number
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

/** 经 ffmpeg -i 解析视频时长与分辨率(解析失败返回空对象,不抛错) */
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
        resolve({ duration, ...dims })
      }
    )
  })
}
