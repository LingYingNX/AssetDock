import { execFileSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureTranscodedVideo,
  resetTranscodeTasks,
  transcodeArgs,
  transcodePath
} from '../src/main/services/transcode'

const roots: string[] = []
const fingerprint = '0123456789abcdef0123'

async function createMkv(root: string): Promise<string> {
  const target = join(root, 'source.mkv')
  execFileSync(ffmpegPath as string, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', target
  ], { timeout: 30_000, windowsHide: true })
  return target
}

afterEach(async () => {
  resetTranscodeTasks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('video transcode cache', () => {
  it('coalesces concurrent requests and writes a playable MP4', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-transcode-'))
    roots.push(root)
    const source = await createMkv(root)
    const progress: Array<number | null> = []

    const first = ensureTranscodedVideo(root, source, fingerprint, {
      duration: 0.5,
      onProgress: (pct) => progress.push(pct)
    })
    const second = ensureTranscodedVideo(root, source, fingerprint, { duration: 0.5 })
    expect(second).toBe(first)
    const output = await first

    await expect(access(output)).resolves.toBeUndefined()
    expect(progress.at(-1)).toBe(100)
    const frame = execFileSync(ffmpegPath as string, [
      '-hide_banner', '-loglevel', 'error', '-i', output,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'
    ], { timeout: 20_000, windowsHide: true })
    expect((await sharp(frame).metadata()).format).toBe('png')
  }, 30_000)

  it('removes a cancelled partial temp file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-transcode-cancel-'))
    roots.push(root)
    const source = await createMkv(root)
    const controller = new AbortController()
    controller.abort()

    await expect(ensureTranscodedVideo(root, source, fingerprint, {
      duration: 0.5,
      signal: controller.signal
    })).rejects.toMatchObject({ kind: 'cancelled' })
    await expect(access(transcodePath(root, fingerprint))).rejects.toThrow()
  }, 30_000)

  it('bounds output resolution and maps optional audio without a shell', () => {
    const args = transcodeArgs('input.mkv', 'output.mp4')
    expect(args).toContain('scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2')
    expect(args).toContain('0:a:0?')
    expect(args).toContain('+faststart')
    expect(args).not.toContain('shell')
  })
})
