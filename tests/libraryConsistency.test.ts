import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryDb } from '../src/main/services/db'
import { absPathOf, canonicalIndexRelPath, findByFingerprint, isPathWithinRoot, normalizeIndexedPaths, realPathWithinRoot } from '../src/main/services/libResolve'
import { closeAllLibHandles, ensureLibraryStorage, openLibDb, openMemoryLibDb } from '../src/main/services/libraryDb'
import { addTag, assetById, listAssets, mergeIndexedRename, renameAssetFolder, setAssetMissing, updateAsset, upsertScanned } from '../src/main/services/store'

function entry(relPath: string, fingerprint: string, mtimeMs = 1) {
  return {
    relPath,
    name: relPath.slice(0, relPath.lastIndexOf('.')),
    type: 'image' as const,
    format: 'JPG',
    sizeBytes: 1,
    mtimeMs,
    fingerprint
  }
}

describe('library consistency', () => {
  it('normalizes display-name paths and keeps same-named indexes separate', () => {
    const db = openMemoryLibDb()
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(1, 'C:/one/assets', 'assets')
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(2, 'C:/two/assets', 'assets')
    db.prepare('INSERT INTO assets(library_id, rel_path, name, type, format, size_bytes, mtime_ms, fingerprint, imported_at, source_index_id) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('assets/legacy.jpg', 'legacy', 'image', 'JPG', 1, 1, 'legacy', '2026-09-05T00:00', 1)

    normalizeIndexedPaths(db, 1, [
      { id: 1, path: 'C:/one/assets', name: 'assets' },
      { id: 2, path: 'C:/two/assets', name: 'assets' }
    ])
    upsertScanned(db, 1, [entry('same.jpg', 'one')], 1)
    upsertScanned(db, 1, [entry('same.jpg', 'two')], 2)

    expect(listAssets(db, 1).map((asset) => [asset.source_index_id, asset.rel_path]).sort()).toEqual([
      [1, canonicalIndexRelPath(1, 'legacy.jpg')],
      [1, canonicalIndexRelPath(1, 'same.jpg')],
      [2, canonicalIndexRelPath(2, 'same.jpg')]
    ])
    expect(absPathOf('C:/library', canonicalIndexRelPath(1, 'same.jpg'), 'C:/one/assets', 1)).toBe(join('C:/one/assets', 'same.jpg'))
    expect(absPathOf('C:/library', canonicalIndexRelPath(2, 'same.jpg'), 'C:/two/assets', 2)).toBe(join('C:/two/assets', 'same.jpg'))
    db.close()
  })

  it('keeps fallback records with the same relative path in their own library', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', 'C:/one')
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(2, 'two', 'C:/two')
    upsertScanned(db, 1, [entry('sub/a.jpg', 'one')])
    upsertScanned(db, 2, [entry('sub/a.jpg', 'two')])

    expect(setAssetMissing(db, 1, 'sub/a.jpg', true)).toBe(true)
    expect(listAssets(db, 1)[0].missing).toBe(1)
    expect(listAssets(db, 2)[0].missing).toBe(0)
    db.close()
  })

  it('updates a changed indexed file while preserving editable metadata', () => {
    const db = openMemoryLibDb()
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(1, 'C:/source', 'source')
    const [first] = upsertScanned(db, 1, [entry('a.jpg', 'first', 1)], 1)
    updateAsset(db, first.assetId, { note: 'keep me', source_url: 'https://example.test/ref' })

    const [changed] = upsertScanned(db, 1, [entry('a.jpg', 'second', 2)], 1)

    expect(changed.action).toBe('changed')
    expect(assetById(db, 1, first.assetId)).toMatchObject({
      fingerprint: 'second',
      mtime_ms: 2,
      note: 'keep me',
      source_url: 'https://example.test/ref'
    })
    db.close()
  })

  it('relocates one missing indexed record with its tags and note', () => {
    const db = openMemoryLibDb()
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(1, 'C:/source', 'source')
    const [old] = upsertScanned(db, 1, [entry('old/a.jpg', 'same', 1)], 1)
    addTag(db, old.assetId, 'nature')
    updateAsset(db, old.assetId, { note: 'move with file' })
    setAssetMissing(db, 1, canonicalIndexRelPath(1, 'old/a.jpg'), true)

    const [moved] = upsertScanned(db, 1, [entry('new/a.jpg', 'same', 1)], 1)

    expect(moved).toMatchObject({
      assetId: old.assetId,
      action: 'relocated',
      previousRelPath: canonicalIndexRelPath(1, 'old/a.jpg')
    })
    expect(assetById(db, 1, old.assetId)).toMatchObject({
      rel_path: canonicalIndexRelPath(1, 'new/a.jpg'),
      missing: 0,
      note: 'move with file',
      tags: [{ name: 'nature', color: expect.any(String) }]
    })
    db.close()
  })

  it('merges a transient indexed add when its matching unlink arrives afterward', () => {
    const db = openMemoryLibDb()
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(1, 'C:/source', 'source')
    const [original] = upsertScanned(db, 1, [entry('old/a.jpg', 'same', 1)], 1)
    updateAsset(db, original.assetId, { note: 'preserved' })
    const [transient] = upsertScanned(db, 1, [entry('new/a.jpg', 'same', 1)], 1)

    expect(mergeIndexedRename(db, 1, 1, 'old/a.jpg', 'new/a.jpg')).toBe(original.assetId)
    expect(assetById(db, 1, original.assetId)).toMatchObject({
      rel_path: canonicalIndexRelPath(1, 'new/a.jpg'),
      note: 'preserved',
      missing: 0
    })
    expect(assetById(db, 1, transient.assetId)).toBeUndefined()
    db.close()
  })

  it('resolves root assets from the global fallback database for thumbnail generation', () => {
    const db = openMemoryDb()
    const root = join(tmpdir(), `mediahub-fallback-${Date.now()}`)
    const fallbackThumbs = join(root, 'global-thumbs')
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'fallback', root)
    upsertScanned(db, 1, [entry('sub/a.jpg', 'fallback-fingerprint')])

    const hit = findByFingerprint('fallback-fingerprint', fallbackThumbs, db)

    expect(hit).toMatchObject({
      absPath: join(root, 'sub/a.jpg'),
      thumbPath: join(fallbackThumbs, 'fallback-fingerprint.webp')
    })
    db.close()
  })

  it('resolves indexed thumbnails to library thumbs and sidecar mirror paths', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mediahub-index-thumb-'))
    const root = join(parent, 'library')
    const registry = openMemoryDb()
    const libDb = openLibDb(root)
    try {
      registry.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'library', root)
      libDb.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(7, 'C:/external', 'external')
      upsertScanned(libDb, 1, [entry('scenery/leaf.png', 'indexed-fingerprint')], 7)

      const hit = findByFingerprint('indexed-fingerprint', join(parent, 'fallback-thumbs'), registry)

      expect(hit).toMatchObject({
        absPath: join('C:/external', 'scenery/leaf.png'),
        thumbPath: join(root, '.mediahub', 'thumbs', 'indexed-fingerprint.webp'),
        sidecarPath: join(root, 'scenery', 'leaf.png.json')
      })
    } finally {
      libDb.close()
      closeAllLibHandles()
      registry.close()
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('renames real asset paths while leaving indexed source paths intact', () => {
    const db = openMemoryLibDb()
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (?, ?, ?)').run(1, 'C:/external', 'assets')
    upsertScanned(db, 1, [entry('sub/a.jpg', 'root')])
    upsertScanned(db, 1, [entry('sub/child/b.jpg', 'nested')])
    upsertScanned(db, 1, [entry('external.jpg', 'index')], 1)
    const indexed = listAssets(db, 1).find((asset) => asset.source_index_id === 1)!
    db.prepare('UPDATE assets SET folder_path = ? WHERE id = ?').run('sub/child', indexed.id)

    renameAssetFolder(db, 1, 'sub', 'renamed')

    expect(listAssets(db, 1).map((asset) => [asset.rel_path, asset.folder_path]).sort()).toEqual([
      [canonicalIndexRelPath(1, 'external.jpg'), 'renamed/child'],
      ['renamed/a.jpg', null],
      ['renamed/child/b.jpg', null]
    ])
    db.close()
  })

  it('treats only true descendants as paths inside a library root', () => {
    expect(isPathWithinRoot('C:\\Media', 'C:\\Media\\sub\\a.jpg')).toBe(true)
    expect(isPathWithinRoot('C:\\Media', 'C:\\Media-backup\\a.jpg')).toBe(false)
    expect(isPathWithinRoot('C:\\Media', 'C:\\other\\a.jpg')).toBe(false)
  })

  it('rejects sibling and Junction paths after resolving their real target', async () => {
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

      expect(await realPathWithinRoot(root, join(root, 'inside.jpg'))).toBeTruthy()
      expect(await realPathWithinRoot(root, join(sibling, 'sibling.jpg'))).toBeNull()
      expect(await realPathWithinRoot(root, join(root, 'escape', 'outside.jpg'))).toBeNull()
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('creates portable storage before indexing and reports an unwritable library path', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mediahub-storage-'))
    const root = join(parent, 'library')
    const blocked = join(parent, 'blocked')
    const db = openMemoryDb()
    try {
      db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'library', root)
      expect(ensureLibraryStorage(db, { id: 1, name: 'library', path: root }, join(parent, 'thumbs'))).toBe(true)
      const libDb = openLibDb(root)
      libDb.prepare('INSERT INTO index_sources(path, name) VALUES (?, ?)').run('C:/external', 'external')
      expect(libDb.prepare('SELECT name FROM index_sources').all()).toEqual([{ name: 'external' }])
      libDb.close()

      await writeFile(blocked, 'not a directory')
      expect(ensureLibraryStorage(db, { id: 2, name: 'blocked', path: blocked }, join(parent, 'thumbs'))).toBe(false)
    } finally {
      db.close()
      await rm(parent, { recursive: true, force: true })
    }
  })
})
