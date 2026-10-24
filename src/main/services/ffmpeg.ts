import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export type MediaProcessFailure = 'failed' | 'timeout' | 'too-large' | 'cancelled'

export class MediaProcessError extends Error {
  constructor(
    message: string,
    readonly kind: MediaProcessFailure
  ) {
    super(message)
    this.name = 'MediaProcessError'
  }
}

export interface ProcessResult {
  stdout: Buffer
  stderr: string
}

export interface ProcessOptions {
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  onStderr?: (text: string) => void
}

/** Execute without a shell so CJK paths and ffmpeg arguments stay inert. */
export function runMediaProcess(
  executable: string,
  args: readonly string[],
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxOutputBytes = options.maxOutputBytes ?? 32 * 1024 * 1024

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let stderrBytes = 0
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const abort = (): void => kill('cancelled', 'media process cancelled')

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') })
    }

    const kill = (kind: MediaProcessFailure, message: string): void => {
      if (settled) return
      try { child.kill() } catch { /* process may already be gone */ }
      finish(new MediaProcessError(message, kind))
    }

    timer = setTimeout(() => kill('timeout', 'media process timed out'), timeoutMs)
    timer.unref?.()
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > maxOutputBytes) {
        kill('too-large', 'media process output exceeded limit')
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      options.onStderr?.(chunk.toString('utf8'))
      if (stderrBytes >= 256 * 1024) return
      const slice = chunk.subarray(0, 256 * 1024 - stderrBytes)
      stderrBytes += slice.length
      stderr.push(slice)
    })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      options.signal?.removeEventListener('abort', abort)
      if (settled) return
      if (code === 0) finish()
      else {
        const detail = Buffer.concat(stderr).toString('utf8').trim().split(/\r?\n/).pop()
        finish(new MediaProcessError(detail || `media process exited with code ${code ?? 'unknown'}`, 'failed'))
      }
    })
  })
}

export function ffmpegExecutable(): string {
  if (!ffmpegPath) throw new MediaProcessError('ffmpeg executable is unavailable', 'failed')
  return ffmpegPath
}

export function runFfmpeg(args: readonly string[], options?: ProcessOptions): Promise<ProcessResult> {
  return runMediaProcess(ffmpegExecutable(), args, options)
}

/** Write via a sibling temp file so interrupted transcodes never look complete. */
export async function writeMediaFileAtomically(
  target: string,
  write: (tempPath: string) => Promise<void>
): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  const tempPath = `${target}.tmp-${process.pid}-${Date.now()}`
  try {
    await write(tempPath)
    const { rename } = await import('node:fs/promises')
    await rename(tempPath, target)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}
