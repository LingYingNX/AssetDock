import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createLibraryFolder, exportLibraryAsset, insertCreatedFolderPath, listLibraryFolders, moveLibraryAsset, moveLibraryFolder, orderLibraryFolders, renameLibraryAsset, renameLibraryFolder, resolveLibraryFolder } from '../src/main/services/folders'
import { deleteFolderTree, listFolderOrders, replaceFolderOrders, renameFolderOrders, upsertScanned } from '../src/main/services/store'
import { openMemoryDb } from '../src/main/services/db'
import { openMemoryLibDb } from '../src/main/services/libraryDb'

describe('library folders', () => {
  let root = ''

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mediahub-folders-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('lists real nested and empty folders but excludes library metadata', async () => {
    await mkdir(join(root, '.mediahub'))
    await mkdir(join(root, 'empty'))
    await mkdir(join(root, 'sub', 'inner'), { recursive: true })
    await expect(listLibraryFolders(root)).resolves.toEqual(['empty', 'sub', 'sub/inner'])
  })

  it('creates uniquely named folders at the library root', async () => {
    await expect(createLibraryFolder(root)).resolves.toBe('未命名')
    await expect(createLibraryFolder(root)).resolves.toBe('未命名 (2)')
  })

  it('creates a uniquely named folder inside the selected parent', async () => {
    await mkdir(join(root, 'parent'))
    await expect(createLibraryFolder(root, 'parent')).resolves.toBe('parent/未命名')
    await expect(createLibraryFolder(root, 'parent')).resolves.toBe('parent/未命名 (2)')
    await expect(listLibraryFolders(root)).resolves.toEqual(['parent', 'parent/未命名', 'parent/未命名 (2)'])
  })

  it('resolves a real folder but rejects paths outside the library', async () => {
    await mkdir(join(root, 'parent', 'child'), { recursive: true })
    await expect(resolveLibraryFolder(root, 'parent/child')).resolves.toBe(join(root, 'parent', 'child'))
    await expect(resolveLibraryFolder(root, '../outside')).rejects.toThrow()
  })

  it('keeps a newly created folder at the front when its order is persisted', async () => {
    await mkdir(join(root, 'existing'))
    const created = await createLibraryFolder(root)
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'Library', root)
    replaceFolderOrders(db, 1, [created, 'existing'])
    const paths = await listLibraryFolders(root)
    expect(orderLibraryFolders(paths, listFolderOrders(db, 1))).toEqual([created, 'existing'])
    db.close()
  })

  it('renames and moves only folders below the current library root', async () => {
    await mkdir(join(root, 'source', 'child'), { recursive: true })
    await mkdir(join(root, 'target'))
    await expect(renameLibraryFolder(root, 'source', 'renamed')).resolves.toBe('renamed')
    await expect(moveLibraryFolder(root, 'renamed', 'target')).resolves.toBe('target/renamed')
    await expect(listLibraryFolders(root)).resolves.toEqual(['target', 'target/renamed', 'target/renamed/child'])
  })

  it('moves a nested folder back to the library root', async () => {
    await mkdir(join(root, 'parent', 'child', 'grandchild'), { recursive: true })
    await expect(moveLibraryFolder(root, 'parent/child', '')).resolves.toBe('child')
    await expect(listLibraryFolders(root)).resolves.toEqual(['child', 'child/grandchild', 'parent'])
  })

  it('moves a library asset and avoids overwriting a same-named file', async () => {
    await mkdir(join(root, 'from'))
    await mkdir(join(root, 'to'))
    await writeFile(join(root, 'from', 'photo.jpg'), 'source')
    await writeFile(join(root, 'to', 'photo.jpg'), 'existing')
    await expect(moveLibraryAsset(root, 'from/photo.jpg', 'to')).resolves.toBe('to/photo (2).jpg')
  })

  it('orders each folder level independently while keeping parents first', () => {
    expect(orderLibraryFolders(['a', 'a/one', 'a/two', 'b'], new Map([['b', 0], ['a/two', 1]]))).toEqual(['b', 'a', 'a/two', 'a/one'])
  })

  it('keeps newly discovered siblings after manually ordered folders', () => {
    expect(orderLibraryFolders(['a', 'b', 'c'], new Map([['b', 0], ['a', 1]]))).toEqual(['b', 'a', 'c'])
  })

  it('persists a newly created nested folder once after its parent subtree', () => {
    const scanned = ['archive', 'archive/keep', 'archive/未命名', 'output', 'project']
    expect(insertCreatedFolderPath(scanned, 'archive/未命名', 'archive')).toEqual([
      'archive',
      'archive/keep',
      'archive/未命名',
      'output',
      'project'
    ])
  })

  it('replaces stale destination order rows during a folder move', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'Library', root)
    replaceFolderOrders(db, 1, ['actions', 'actions/categories', 'places/actions', 'places/actions/categories'])
    renameFolderOrders(db, 1, 'actions', 'places/actions')
    expect([...listFolderOrders(db, 1).keys()].sort()).toEqual(['places/actions', 'places/actions/categories'])
    db.close()
  })

  it('removes a folder subtree from the asset index and folder order', () => {
    const db = openMemoryLibDb()
    db.pragma('foreign_keys = ON')
    const entries = ['tree/a.png', 'tree/child/b.png', 'treehouse/c.png'].map((relPath, index) => ({
      relPath,
      name: relPath.split('/').pop()!,
      type: 'image' as const,
      format: 'PNG',
      sizeBytes: 1,
      mtimeMs: index + 1,
      fingerprint: String(index + 1).padStart(20, 'a')
    }))
    const [under, child, sibling] = upsertScanned(db, 1, entries)
    db.prepare('INSERT INTO tags(id, name, color) VALUES (1, ?, ?)').run('tag', '#000000')
    db.prepare('INSERT INTO asset_tags(asset_id, tag_id) VALUES (?, 1)').run(under.assetId)
    replaceFolderOrders(db, 1, ['tree', 'tree/child', 'treehouse'])

    const deleted = deleteFolderTree(db, 1, 'tree')
    expect(deleted.assets).toBe(2)
    expect(deleted.fingerprints).toHaveLength(2)
    expect(db.prepare('SELECT rel_path FROM assets ORDER BY rel_path').all()).toEqual([{ rel_path: sibling.relPath }])
    expect(db.prepare('SELECT 1 FROM assets WHERE id = ?').get(child.assetId)).toBeUndefined()
    expect([...listFolderOrders(db, 1).keys()]).toEqual(['treehouse'])
    db.close()
  })
})

describe('exportLibraryAsset', () => {
  let root = ''
  let dest = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mediahub-export-src-'))
    dest = await mkdtemp(join(tmpdir(), 'mediahub-export-dst-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(dest, { recursive: true, force: true })
  })

  it('copies the asset out without touching the library copy', async () => {
    await mkdir(join(root, 'sub'))
    await writeFile(join(root, 'sub', 'a.jpg'), 'payload')
    const written = await exportLibraryAsset(root, 'sub/a.jpg', dest)
    expect(basename(written)).toBe('a.jpg')
    await expect(readFile(written, 'utf8')).resolves.toBe('payload')
    await expect(readFile(join(root, 'sub', 'a.jpg'), 'utf8')).resolves.toBe('payload')
  })

  it('avoids overwriting an existing file in the destination', async () => {
    await writeFile(join(root, 'a.jpg'), 'new')
    await writeFile(join(dest, 'a.jpg'), 'existing')
    const written = await exportLibraryAsset(root, 'a.jpg', dest)
    expect(basename(written)).toBe('a (2).jpg')
    await expect(readFile(join(dest, 'a.jpg'), 'utf8')).resolves.toBe('existing')
    await expect(readFile(written, 'utf8')).resolves.toBe('new')
  })

  it('rejects a path outside the library root', async () => {
    await expect(exportLibraryAsset(root, '../escape.jpg', dest)).rejects.toThrow()
  })

  it('renames an asset in place and keeps its extension', async () => {
    await mkdir(join(root, 'sub'))
    await writeFile(join(root, 'sub', 'old.png'), 'payload')

    const rel = await renameLibraryAsset(root, 'sub/old.png', 'new name')
    expect(rel).toBe('sub/new name.png')
    await expect(readFile(join(root, 'sub', 'new name.png'), 'utf8')).resolves.toBe('payload')
    await expect(readFile(join(root, 'sub', 'old.png'), 'utf8')).rejects.toThrow()
  })

  it('does not double up the extension when the name already carries it', async () => {
    await writeFile(join(root, 'old.png'), 'payload')
    await expect(renameLibraryAsset(root, 'old.png', 'fresh.png')).resolves.toBe('fresh.png')
    await expect(readFile(join(root, 'fresh.png'), 'utf8')).resolves.toBe('payload')
  })

  it('refuses to clobber an existing sibling file', async () => {
    await writeFile(join(root, 'a.png'), 'A')
    await writeFile(join(root, 'b.png'), 'B')
    await expect(renameLibraryAsset(root, 'a.png', 'b')).rejects.toThrow('同名')
    await expect(readFile(join(root, 'a.png'), 'utf8')).resolves.toBe('A')
    await expect(readFile(join(root, 'b.png'), 'utf8')).resolves.toBe('B')
  })

  it('rejects invalid names and paths outside the library', async () => {
    await writeFile(join(root, 'a.png'), 'A')
    await expect(renameLibraryAsset(root, 'a.png', 'bad/name')).rejects.toThrow()
    await expect(renameLibraryAsset(root, 'a.png', '..')).rejects.toThrow()
    await expect(renameLibraryAsset(root, '../outside.png', 'x')).rejects.toThrow()
  })
})
