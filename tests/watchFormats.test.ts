import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/services/formatProbe', () => ({
  probeImageMeta: vi.fn(async () => ({}))
}))
vi.mock('../src/main/services/videoMeta', () => ({
  probeVideo: vi.fn(async () => ({ width: 32, height: 24, duration: 1, codec: 'h264', fps: 25 }))
}))

import { openMemoryDb } from '../src/main/services/db'
import { listAssets } from '../src/main/services/store'
import { watchLibrary } from '../src/main/services/watch'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('expanded watcher formats', () => {
  it('adds and misses PMX, BLEND and MKV through the shared registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-watch-formats-'))
    roots.push(root)
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', root)
    const watcher = watchLibrary(db, 1, root, {
      onAdded: () => undefined,
      onChanged: () => undefined,
      onMissing: () => undefined
    })

    try {
      await once(watcher, 'ready')
      await Promise.all([
        writeFile(join(root, 'girl.pmx'), 'pmx'),
        writeFile(join(root, 'scene.blend'), 'blend'),
        writeFile(join(root, 'clip.mkv'), 'mkv')
      ])
      await vi.waitFor(() => expect(listAssets(db, 1)).toHaveLength(3), { timeout: 5000 })
      expect(listAssets(db, 1).map((asset) => asset.format).sort()).toEqual(['BLEND', 'MKV', 'PMX'])

      await rm(join(root, 'scene.blend'))
      await vi.waitFor(() => {
        expect(listAssets(db, 1).find((asset) => asset.format === 'BLEND')?.missing).toBe(1)
      }, { timeout: 5000 })
    } finally {
      await watcher.close()
      db.close()
    }
  })
})
