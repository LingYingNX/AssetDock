import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
})
