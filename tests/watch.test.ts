import { once } from 'node:events'
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openMemoryDb } from '../src/main/services/db'
import { listAssets, updateAsset, upsertScanned } from '../src/main/services/store'
import { WATCH_OPTIONS, watchLibrary } from '../src/main/services/watch'

describe('library watcher', () => {
  it('uses native events instead of Windows polling', () => {
    expect(WATCH_OPTIONS.usePolling).toBe(false)
  })

  it('allows externally renaming a watched folder and refreshes the view', async () => {
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
      await vi.waitFor(() => expect(changes).toBeGreaterThan(1), { timeout: 5000 })
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

  it('retains indexed metadata when an external file is renamed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-watch-index-'))
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', root)
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(1, root, 'source')
    const watcher = watchLibrary(db, 1, root, {
      onAdded: () => undefined,
      onChanged: () => undefined,
      onMissing: () => undefined
    }, { sourceIndexId: 1 })

    try {
      await once(watcher, 'ready')
      await writeFile(join(root, 'old.jpg'), 'one')
      await vi.waitFor(() => expect(listAssets(db, 1)).toHaveLength(1), { timeout: 5000 })
      const original = listAssets(db, 1)[0]
      updateAsset(db, original.id, { note: 'preserved' })

      await rename(join(root, 'old.jpg'), join(root, 'new.jpg'))
      await vi.waitFor(() => expect(listAssets(db, 1)).toEqual([
        expect.objectContaining({
          id: original.id,
          rel_path: '@index:1/new.jpg',
          note: 'preserved',
          missing: 0
        })
      ]), { timeout: 5000 })
    } finally {
      await watcher.close()
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes a truly deleted indexed record after the rename window', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-watch-index-delete-'))
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', root)
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(1, root, 'source')
    const watcher = watchLibrary(db, 1, root, {
      onAdded: () => undefined,
      onChanged: () => undefined,
      onMissing: () => undefined
    }, { sourceIndexId: 1 })

    try {
      await once(watcher, 'ready')
      await writeFile(join(root, 'gone.jpg'), 'one')
      await vi.waitFor(() => expect(listAssets(db, 1)).toHaveLength(1), { timeout: 5000 })
      await rm(join(root, 'gone.jpg'))
      await vi.waitFor(() => expect(listAssets(db, 1)).toHaveLength(0), { timeout: 5000 })
    } finally {
      await watcher.close()
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps reporting indexed additions when derivative synchronization fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-watch-index-failure-'))
    const db = openMemoryDb()
    let changed = 0
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', root)
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(1, root, 'source')
    const watcher = watchLibrary(db, 1, root, {
      onAdded: () => undefined,
      onChanged: () => { changed++ },
      onMissing: () => undefined
    }, {
      sourceIndexId: 1,
      onUpsert: async () => { throw new Error('cache unavailable') }
    })

    try {
      await once(watcher, 'ready')
      await writeFile(join(root, 'a.jpg'), 'one')
      await vi.waitFor(() => expect(listAssets(db, 1)).toHaveLength(1), { timeout: 5000 })
      await vi.waitFor(() => expect(changed).toBe(1), { timeout: 5000 })
    } finally {
      await watcher.close()
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
