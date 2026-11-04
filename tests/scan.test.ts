import { mkdtemp, rm, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../src/main/services/db'
import { scanLibrary } from '../src/main/services/scan'
import { upsertScanned, type ScanEntry } from '../src/main/services/store'

describe('library scan', () => {
  it('scans batches without a preview scheduler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-scan-'))
    const db = openMemoryDb()
    try {
      db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'scan', root)
      await Promise.all(Array.from({ length: 65 }, (_, index) => writeFile(join(root, `asset-${index}.obj`), 'model')))
      const progress: number[] = []
      const batches: number[] = []
      await expect(scanLibrary(root, (done) => progress.push(done), undefined, (batch) => {
        batches.push(batch.length)
        upsertScanned(db, 1, batch)
      })).resolves.toHaveLength(65)
      expect(progress).toEqual([20, 40, 60, 65])
      expect(batches.reduce((sum, count) => sum + count, 0)).toBe(65)
      expect(batches.length).toBeGreaterThan(1)
      expect(db.prepare('SELECT COUNT(*) AS count FROM assets WHERE library_id = 1').get()).toEqual({ count: 65 })
    } finally {
      db.close()
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

  it('reuses the stored fingerprint for files whose size and mtime are unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-scan-known-'))
    try {
      const file = join(root, 'same-size.jpg')
      await writeFile(file, 'aaa')
      const stamp = new Date(1_700_000_000_000)
      await utimes(file, stamp, stamp)
      const [first] = await scanLibrary(root)
      // 同大小改内容但保留 mtime:对账应视为未变,不重新读文件
      await writeFile(file, 'bbb')
      await utimes(file, stamp, stamp)
      const known = new Map([[first.relPath, {
        sizeBytes: first.sizeBytes,
        mtimeMs: first.mtimeMs,
        fingerprint: first.fingerprint
      }]])
      const [second] = await scanLibrary(root, undefined, undefined, undefined, known)
      expect(second.fingerprint).toBe(first.fingerprint)

      // mtime 变了就必须重新指纹
      const later = new Date(stamp.getTime() + 5000)
      await utimes(file, later, later)
      const [third] = await scanLibrary(root, undefined, undefined, undefined, known)
      expect(third.fingerprint).not.toBe(first.fingerprint)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('persists ten thousand synthetic entries', () => {
    const db = openMemoryDb()
    try {
      db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'batch', 'C:/batch')
      const entries: ScanEntry[] = Array.from({ length: 10_000 }, (_, index) => ({
        relPath: `synthetic/asset-${index}.obj`,
        name: `asset-${index}`,
        type: 'model',
        format: 'OBJ',
        sizeBytes: 1,
        mtimeMs: 1,
        fingerprint: `synthetic-${index}`
      }))
      upsertScanned(db, 1, entries)
      expect(db.prepare('SELECT COUNT(*) AS count FROM assets WHERE library_id = 1').get()).toEqual({ count: 10_000 })
    } finally {
      db.close()
    }
  })
})
