import { join } from 'node:path'
import { fileExists } from './cacheFiles'
import { runFfmpeg, writeMediaFileAtomically } from './ffmpeg'

const active = new Map<string, Promise<string>>()

export function transcodesDir(libPath: string): string {
  return join(libPath, '.mediahub', 'transcodes')
}

export function transcodePath(libPath: string, fingerprint: string): string {
  return join(transcodesDir(libPath), `${fingerprint}.mp4`)
}

export function transcodeArgs(absPath: string, outputPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostats',
    '-progress', 'pipe:2',
    '-y',
    '-i', absPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn',
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath
  ]
}

export interface TranscodeOptions {
  duration?: number | null
  signal?: AbortSignal
  onProgress?: (percent: number | null) => void
}

export function ensureTranscodedVideo(
  libPath: string,
  absPath: string,
  fingerprint: string,
  options: TranscodeOptions = {}
): Promise<string> {
  if (!/^[0-9a-f]{20}$/i.test(fingerprint)) return Promise.reject(new Error('invalid fingerprint'))
  const target = transcodePath(libPath, fingerprint)
  const key = `${libPath}\0${fingerprint}`
  const running = active.get(key)
  if (running) return running

  const task = (async () => {
    if (await fileExists(target)) return target
    options.onProgress?.(null)
    let progressText = ''
    let lastPct = -1
    await writeMediaFileAtomically(target, async (tempPath) => {
      await runFfmpeg(transcodeArgs(absPath, tempPath), {
        timeoutMs: 10 * 60_000,
        maxOutputBytes: 8 * 1024 * 1024,
        signal: options.signal,
        onStderr: (chunk) => {
          progressText += chunk
          const lines = progressText.split(/\r?\n/)
          progressText = lines.pop() ?? ''
          for (const line of lines) {
            const match = /^out_time_ms=(\d+)$/.exec(line.trim())
            if (!match || !options.duration || options.duration <= 0) continue
            const seconds = Number(match[1]) / 1_000_000
            const pct = Math.min(99, Math.max(1, Math.floor(seconds / options.duration * 100)))
            if (pct !== lastPct) {
              lastPct = pct
              options.onProgress?.(pct)
            }
          }
        }
      })
    })
    options.onProgress?.(100)
    return target
  })()

  active.set(key, task)
  void task.finally(() => {
    if (active.get(key) === task) active.delete(key)
  }).catch(() => undefined)
  return task
}

/** Test helper; active production tasks are short-lived and keyed by fingerprint. */
export function resetTranscodeTasks(): void {
  active.clear()
}
