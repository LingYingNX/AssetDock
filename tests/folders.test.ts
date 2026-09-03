import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLibraryFolder, listLibraryFolders, moveLibraryAsset, renameLibraryFolder } from '../src/main/services/folders'

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

  it('renames a library folder without allowing traversal or collisions', async () => {
    await mkdir(join(root, 'sub', 'old'), { recursive: true })
    await mkdir(join(root, 'sub', 'taken'))

    await writeFile(join(root, 'picture.jpg'), 'one')
    await mkdir(join(root, 'target'))
    await expect(moveLibraryAsset(root, 'picture.jpg', 'target')).resolves.toBe('target/picture.jpg')
    await expect(stat(join(root, 'target', 'picture.jpg'))).resolves.toBeDefined()

    await writeFile(join(root, 'picture.jpg'), 'two')
    await expect(moveLibraryAsset(root, 'picture.jpg', 'target')).resolves.toBe('target/picture (2).jpg')
    await expect(moveLibraryAsset(root, 'picture.jpg', '../outside')).rejects.toThrow()

    await expect(renameLibraryFolder(root, 'sub/old', 'new')).resolves.toBe('sub/new')
    await expect(renameLibraryFolder(root, 'sub/new', '../outside')).rejects.toThrow()
    await expect(renameLibraryFolder(root, 'sub/new', 'taken')).rejects.toThrow()
    await expect(stat(join(root, 'sub', 'new'))).resolves.toBeDefined()
  })
})
