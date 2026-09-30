import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanLibrary } from '../src/main/services/scan'

describe('library scan', () => {
  it('scans batches without a preview scheduler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-scan-'))
    try {
      await Promise.all(Array.from({ length: 65 }, (_, index) => writeFile(join(root, `asset-${index}.obj`), 'model')))
      const progress: number[] = []
      await expect(scanLibrary(root, (done) => progress.push(done))).resolves.toHaveLength(65)
      expect(progress).toEqual([20, 40, 60, 65])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('collects css as a style asset without media metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-scan-css-'))
    try {
      await mkdir(join(root, 'styles'))
      await writeFile(join(root, 'styles', 'loader.css'), '.loader{color:seagreen}')
      const entries = await scanLibrary(root)
      const css = entries.find((e) => e.relPath === 'styles/loader.css')
      expect(css).toBeDefined()
      expect(css?.type).toBe('style')
      expect(css?.format).toBe('CSS')
      expect(css?.name).toBe('loader')
      // 不做媒体元数据采集:sharp/ffmpeg 都不该被调用,字段保持空
      expect(css?.width).toBeUndefined()
      expect(css?.height).toBeUndefined()
      expect(css?.duration).toBeUndefined()
      expect(css?.fingerprint).toBeTruthy()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})