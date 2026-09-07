import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLibraryFolder, listLibraryFolders, moveLibraryAsset, renameLibraryFolder } from '../src/main/services/folders'
import { migrateLibrary, openLibDb, openMemoryLibDb } from '../src/main/services/libraryDb'
import { canonicalIndexRelPath } from '../src/main/services/libResolve'
import { listAssets, renameAssetFolder, setAssetFolder, upsertScanned } from '../src/main/services/store'

describe('library folders', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mediahub-folders-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists real nested and empty folders but excludes library metadata', async () => {
    await mkdir(join(root, '.mediahub'))
    await mkdir(join(root, 'empty'))
    await mkdir(join(root, 'sub', 'inner'), { recursive: true })

    await expect(listLibraryFolders(root)).resolves.toEqual(['empty', 'sub', 'sub/inner'])
  })

  it('creates uniquely named folders at the library root', async () => {
    await expect(createLibraryFolder(root)).resolves.toBe('未命名')
    await expect(createLibraryFolder(root)).resolves.toBe('未命名 (2)')
    await expect(stat(join(root, '未命名'))).resolves.toBeDefined()
    await expect(stat(join(root, '未命名 (2)'))).resolves.toBeDefined()
  })

  it('assigns an indexed asset to a folder without touching the source file', async () => {
    const source = join(root, 'external.jpg')
    await writeFile(source, 'external')
    await mkdir(join(root, 'target'))
    const db = openMemoryLibDb()
    db.prepare('INSERT INTO index_sources(path, name) VALUES (?, ?)').run(root, 'external')
    db.prepare('INSERT INTO assets(library_id, rel_path, name, type, format, size_bytes, mtime_ms, fingerprint, imported_at, source_index_id) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(canonicalIndexRelPath(1, 'external.jpg'), 'external', 'image', 'JPG', 8, 1, 'fp', '2026-09-03T00:00', 1)

    setAssetFolder(db, 1, 'target')
    const asset = listAssets(db, 1)[0]
    expect(asset.folder_path).toBe('target')
    expect(asset.rel_path).toBe(canonicalIndexRelPath(1, 'external.jpg'))
    expect(asset.source_index_id).toBe(1)
    await expect(stat(source)).resolves.toBeDefined()
    await expect(stat(join(root, 'target', 'external.jpg'))).rejects.toThrow()
    db.close()
  })

  it('updates indexed folder assignments when a library folder is renamed', () => {
    const db = openMemoryLibDb()
    db.prepare('INSERT INTO index_sources(id, path, name) VALUES (1, ?, ?)').run('C:/external', 'external')
    const insert = db.prepare('INSERT INTO assets(library_id, rel_path, name, type, format, size_bytes, mtime_ms, fingerprint, imported_at, source_index_id, folder_path) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insert.run(canonicalIndexRelPath(1, 'a.jpg'), 'asset', 'image', 'JPG', 8, 1, 'fp-a', '2026-09-03T00:00', 1, 'old')
    insert.run(canonicalIndexRelPath(1, 'b.jpg'), 'asset', 'image', 'JPG', 8, 1, 'fp-b', '2026-09-03T00:00', 1, 'old/child')
    insert.run(canonicalIndexRelPath(1, 'c.jpg'), 'asset', 'image', 'JPG', 8, 1, 'fp-c', '2026-09-03T00:00', 1, 'other')

    renameAssetFolder(db, 1, 'old', 'new')

    expect(listAssets(db, 1).map((asset) => asset.folder_path).sort()).toEqual(['new', 'new/child', 'other'])
    db.close()
  })

  it('renames a library folder without allowing traversal or collisions', async () => {
    await mkdir(join(root, 'sub', 'old'), { recursive: true })
    await mkdir(join(root, 'sub', 'taken'))
    await mkdir(join(root, 'target'), { recursive: true })

    await writeFile(join(root, 'picture.jpg'), 'one')
    await expect(moveLibraryAsset(root, 'picture.jpg', 'target')).resolves.toBe('target/picture.jpg')
    await expect(stat(join(root, 'target', 'picture.jpg'))).resolves.toBeDefined()

    await writeFile(join(root, 'sub', 'inside.jpg'), 'inside')
    await expect(moveLibraryAsset(root, 'sub/inside.jpg', '')).resolves.toBe('inside.jpg')
    await expect(stat(join(root, 'inside.jpg'))).resolves.toBeDefined()

    await writeFile(join(root, 'picture.jpg'), 'two')
    await expect(moveLibraryAsset(root, 'picture.jpg', 'target')).resolves.toBe('target/picture (2).jpg')
    await expect(moveLibraryAsset(root, 'picture.jpg', '../outside')).rejects.toThrow()

    await expect(renameLibraryFolder(root, 'sub/old', 'new')).resolves.toBe('sub/new')
    await expect(renameLibraryFolder(root, 'sub/new', '../outside')).rejects.toThrow()
    await expect(renameLibraryFolder(root, 'sub/new', 'taken')).rejects.toThrow()
    await expect(stat(join(root, 'sub', 'new'))).resolves.toBeDefined()
  })

  it('preserves indexed source and folder assignment when the index is rescanned', () => {
    const db = openMemoryLibDb()
    db.prepare('INSERT INTO index_sources(path, name) VALUES (?, ?)').run('C:/external', 'external')
    const entry = {
      relPath: 'indexed.jpg',
      name: 'indexed',
      type: 'image' as const,
      format: 'JPG',
      sizeBytes: 10,
      mtimeMs: 1,
      fingerprint: 'same-fingerprint'
    }

    upsertScanned(db, 1, [entry], 1)
    const assetId = listAssets(db, 1)[0].id
    setAssetFolder(db, assetId, 'target')
    upsertScanned(db, 1, [entry], 1)

    const [asset] = listAssets(db, 1)
    expect(listAssets(db, 1)).toHaveLength(1)
    expect(asset.rel_path).toBe(canonicalIndexRelPath(1, 'indexed.jpg'))
    expect(asset.source_index_id).toBe(1)
    expect(asset.folder_path).toBe('target')
    db.close()
  })

  it('migrates indexed source and folder assignment into the library database', () => {
    const globalDb = openMemoryLibDb()
    globalDb.exec('CREATE TABLE libraries (id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE)')
    globalDb.prepare('INSERT INTO libraries(id, name, path) VALUES (7, ?, ?)').run('Library', root)
    globalDb.prepare('INSERT INTO index_sources(id, path, name) VALUES (7, ?, ?)').run('C:/external', 'external')
    globalDb.prepare('INSERT INTO assets(library_id, rel_path, name, type, format, size_bytes, mtime_ms, fingerprint, imported_at, source_index_id, folder_path) VALUES (7, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('external/indexed.jpg', 'indexed', 'image', 'JPG', 10, 1, 'fp', '2026-09-03T00:00', 7, 'target')

    expect(migrateLibrary(globalDb, { id: 7, name: 'Library', path: root }, join(root, 'fallback-thumbs'))).toBe(true)
    const db = openLibDb(root)
    const source = db.prepare('SELECT id, path, name FROM index_sources WHERE id = 7').get() as { id: number; path: string; name: string }
    const asset = db.prepare('SELECT library_id, rel_path, source_index_id, folder_path FROM assets WHERE rel_path = ?').get('external/indexed.jpg') as
      { library_id: number; rel_path: string; source_index_id: number; folder_path: string }

    expect(source).toEqual({ id: 7, path: 'C:/external', name: 'external' })
    expect(asset).toEqual({ library_id: 7, rel_path: 'external/indexed.jpg', source_index_id: 7, folder_path: 'target' })
    db.close()
    globalDb.close()
  })
})
