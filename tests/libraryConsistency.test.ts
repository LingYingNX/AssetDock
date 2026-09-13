import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../src/main/services/db'
import { isPathWithinRoot, realPathWithinRoot } from '../src/main/services/libResolve'
import { closeAllLibHandles, ensureLibraryStorage, openLibDb } from '../src/main/services/libraryDb'
import { addTag, assetById, listAssets, renameAssetFolder, updateAsset, upsertScanned } from '../src/main/services/store'

const entry = (relPath: string, fingerprint: string, mtimeMs = 1) => ({
  relPath, name: relPath.slice(0, relPath.lastIndexOf('.')), type: 'image' as const, format: 'JPG', sizeBytes: 1, mtimeMs, fingerprint
})

describe('library consistency', () => {
  it('keeps same relative paths isolated by library', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', 'C:/one')
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(2, 'two', 'C:/two')
    upsertScanned(db, 1, [entry('sub/a.jpg', 'one')])
    upsertScanned(db, 2, [entry('sub/a.jpg', 'two')])
    expect(listAssets(db, 1)[0].fingerprint).toBe('one')
    expect(listAssets(db, 2)[0].fingerprint).toBe('two')
    db.close()
  })

  it('refreshes scanned metadata without losing user metadata', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', 'C:/one')
    const [first] = upsertScanned(db, 1, [entry('a.jpg', 'first')])
    addTag(db, first.assetId, 'nature')
    updateAsset(db, first.assetId, { note: 'keep me', rating: 5, source_url: 'https://example.test/ref' })
    upsertScanned(db, 1, [entry('a.jpg', 'second', 2)])
    expect(assetById(db, 1, first.assetId)).toMatchObject({ fingerprint: 'second', mtime_ms: 2, note: 'keep me', rating: 5, tags: [{ name: 'nature', color: expect.any(String) }] })
    db.close()
  })

  it('updates every local descendant when a library folder is renamed', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', 'C:/one')
    upsertScanned(db, 1, [entry('sub/a.jpg', 'a'), entry('sub/child/b.jpg', 'b')])
    renameAssetFolder(db, 1, 'sub', 'renamed')
    expect(listAssets(db, 1).map((asset) => asset.rel_path).sort()).toEqual(['renamed/a.jpg', 'renamed/child/b.jpg'])
    db.close()
  })

  it('rejects sibling and Junction paths outside a library root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mediahub-path-'))
    const root = join(parent, 'Media')
    const sibling = join(parent, 'Media-backup')
    const outside = join(parent, 'outside')
    try {
      await mkdir(root)
      await mkdir(sibling)
      await mkdir(outside)
      await writeFile(join(root, 'inside.jpg'), 'inside')
      await writeFile(join(sibling, 'sibling.jpg'), 'sibling')
      await writeFile(join(outside, 'outside.jpg'), 'outside')
      await symlink(outside, join(root, 'escape'), 'junction')
      expect(isPathWithinRoot(root, join(root, 'inside.jpg'))).toBe(true)
      expect(isPathWithinRoot(root, join(sibling, 'sibling.jpg'))).toBe(false)
      expect(await realPathWithinRoot(root, join(root, 'escape', 'outside.jpg'))).toBeNull()
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('creates portable storage without a thumbnail cache', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mediahub-storage-'))
    const root = join(parent, 'library')
    const db = openMemoryDb()
    try {
      db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'library', root)
      expect(ensureLibraryStorage(db, { id: 1, name: 'library', path: root })).toBe(true)
      const libDb = openLibDb(root)
      libDb.close()
      await expect(access(join(root, '.mediahub', 'thumbs'))).rejects.toThrow()
    } finally {
      closeAllLibHandles()
      db.close()
      await rm(parent, { recursive: true, force: true })
    }
  })
})
