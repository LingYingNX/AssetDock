import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { afterEach, describe, expect, it } from 'vitest'
import { probeVideo } from '../src/main/services/videoMeta'

const roots: string[] = []
const samples: Array<{ ext: string; codec: string }> = [
  { ext: 'mp4', codec: 'libx264' },
  { ext: 'mov', codec: 'libx264' },
  { ext: 'webm', codec: 'libvpx-vp9' },
  { ext: 'mkv', codec: 'libx264' },
  { ext: 'avi', codec: 'mpeg4' },
  { ext: 'flv', codec: 'flv' },
  { ext: 'wmv', codec: 'wmv2' },
  { ext: 'mpg', codec: 'mpeg2video' },
  { ext: 'ts', codec: 'mpeg2video' }
]

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('video container probing', () => {
  it.each(samples)('reads $ext metadata without full decode', async ({ ext, codec }) => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-video-'))
    roots.push(root)
    const path = join(root, `sample.${ext}`)
    execFileSync(ffmpegPath as string, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=32x24:rate=10',
      '-t', '0.3', '-c:v', codec, '-pix_fmt', 'yuv420p', path
    ], { timeout: 20_000 })

    const meta = await probeVideo(path)
    expect(meta.width).toBe(32)
    expect(meta.height).toBe(24)
    expect(meta.duration).toBeGreaterThan(0)
    expect(meta.codec).toBeTruthy()
    expect(meta.fps).toBeGreaterThan(0)
  }, 30_000)
})
