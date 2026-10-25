import { once } from 'node:events'
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openMemoryDb } from '../src/main/services/db'
import { listAssets, upsertScanned } from '../src/main/services/store'
import { WATCH_OPTIONS, watchLibrary } from '../src/main/services/watch'

describe('library watcher', () => {
  it('uses native events instead of Windows polling', () => {
    expect(WATCH_OPTIONS.usePolling).toBe(false)
  })

  it('coalesces a folder rename into one refresh', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-watch-'))
    let changes = 0
    const watcher = watchLibrary({} as never, 1, root, {
      onAdded: () => undefined,
      onChanged: () => { changes++ },
      onMissing: () => undefined
    })

    try {
      await once(watcher, 'ready')
      const added = once(watcher, 'addDir')
      await mkdir(join(root, 'old'))
      await added
      await rename(join(root, 'old'), join(root, 'new'))
      await vi.waitFor(() => expect(changes).toBe(1), { timeout: 5000 })
    } finally {
      await watcher.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('updates only the watched library when another fallback library has the same path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-watch-db-'))
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', root)
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(2, 'two', join(root, 'other'))
    upsertScanned(db, 2, [{ relPath: 'a.jpg', name: 'a', type: 'image', format: 'JPG', sizeBytes: 1, mtimeMs: 1, fingerprint: 'other' }])
    const watcher = watchLibrary(db, 1, root, {
      onAdded: () => undefined,
      onChanged: () => undefined,
      onMissing: () => undefined
    })

    try {
      await once(watcher, 'ready')
      await writeFile(join(root, 'a.jpg'), 'one')
      await vi.waitFor(() => expect(listAssets(db, 1)).toHaveLength(1), { timeout: 5000 })
      await rm(join(root, 'a.jpg'))
      await vi.waitFor(() => expect(listAssets(db, 1)[0].missing).toBe(1), { timeout: 5000 })
      expect(listAssets(db, 2)[0].missing).toBe(0)
    } finally {
      await watcher.close()
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('ingests css files without extracting a palette', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-watch-css-'))
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', root)
    const watcher = watchLibrary(db, 1, root, {
      onAdded: () => undefined,
      onChanged: () => undefined,
      onMissing: () => undefined
    })

    try {
      await once(watcher, 'ready')
      await writeFile(join(root, 'loader.css'), '.loader{color:seagreen}')
      await vi.waitFor(() => expect(listAssets(db, 1)).toHaveLength(1), { timeout: 5000 })
      const asset = listAssets(db, 1)[0]
      expect(asset.type).toBe('style')
      expect(asset.format).toBe('CSS')
      // CSS 没有可解码像素,主色必须保持为空而不是报错或留下脏值
      expect(JSON.parse(asset.palette || '[]')).toEqual([])
    } finally {
      await watcher.close()
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
