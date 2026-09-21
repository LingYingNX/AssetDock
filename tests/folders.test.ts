import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createLibraryFolder, exportLibraryAsset, listLibraryFolders, moveLibraryAsset, moveLibraryFolder, orderLibraryFolders, renameLibraryFolder } from '../src/main/services/folders'
import { listFolderOrders, replaceFolderOrders } from '../src/main/services/store'
import { openMemoryDb } from '../src/main/services/db'

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
})
