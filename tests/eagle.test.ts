import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { moveEagleLibraryAssets, scanEagleLibrary } from '../src/main/services/eagle'

describe('Eagle import', () => {
  it('uses only original files and retains its virtual folder hierarchy', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mediahub-eagle-'))
    const root = join(parent, '图.library')
    const first = join(root, 'images', 'A.info')
    const second = join(root, 'images', 'B.info')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    try {
      await writeFile(join(root, 'metadata.json'), JSON.stringify({
        folders: [{ id: 'folder', name: '插画', orderBy: 'MANUAL', sortIncrease: true, children: [{ id: 'child', name: '人物', children: [] }] }]
      }))
      await writeFile(join(root, 'mtime.json'), JSON.stringify({ A: 2, B: 1 }))
      await writeFile(join(first, 'metadata.json'), JSON.stringify({ id: 'A', name: 'first', ext: 'jpg', btime: 100, mtime: 200, folders: ['child'] }))
      await writeFile(join(second, 'metadata.json'), JSON.stringify({ id: 'B', name: 'second', ext: 'jpg', btime: 90, mtime: 190, folders: ['folder'] }))
      await writeFile(join(first, 'first.jpg'), 'original')
      await writeFile(join(first, 'first_thumbnail.png'), 'preview copy')
      await writeFile(join(second, 'second.jpg'), 'original')

      const imported = await scanEagleLibrary(root)
      expect(imported.entries.map((entry) => entry.relPath)).toEqual(['images/A.info/first.jpg', 'images/B.info/second.jpg'])
      expect(imported.folders.map((folder) => folder.path)).toEqual(['图', '图/插画', '图/插画/人物'])
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('moves original files into the current library and keeps one physical copy per asset', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mediahub-eagle-move-'))
    const root = join(parent, '图.library')
    const target = join(parent, '素材')
    const first = join(root, 'images', 'A.info')
    const second = join(root, 'images', 'B.info')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    try {
      await writeFile(join(root, 'metadata.json'), JSON.stringify({
        folders: [{ id: 'folder', name: '插画', children: [{ id: 'child', name: '人物', children: [] }] }, { id: 'empty', name: '空目录', children: [] }]
      }))
      await writeFile(join(first, 'metadata.json'), JSON.stringify({ id: 'A', name: 'first', ext: 'jpg', folders: ['child'] }))
      await writeFile(join(second, 'metadata.json'), JSON.stringify({ id: 'B', name: 'second', ext: 'jpg', folders: ['child', 'folder'] }))
      await writeFile(join(first, 'first.jpg'), 'one')
      await writeFile(join(second, 'second.jpg'), 'two')

      const eagle = await scanEagleLibrary(root)
      const imported = await moveEagleLibraryAssets(root, target, eagle)
      expect(imported).toMatchObject({ imported: 2, multiFolderAssets: 1 })
      expect(imported.entries.map((entry) => entry.relPath)).toEqual(['图/插画/人物/first.jpg', '图/插画/人物/second.jpg'])

      await expect(access(join(first, 'first.jpg'))).rejects.toThrow()
      await expect(access(join(second, 'second.jpg'))).rejects.toThrow()
      await expect(access(join(target, '图', '插画', '人物', 'first.jpg'))).resolves.toBeUndefined()
      await expect(access(join(target, '图', '插画', '人物', 'second.jpg'))).resolves.toBeUndefined()
      await expect(access(join(target, '图', '空目录'))).resolves.toBeUndefined()
      await expect(access(join(target, '图', '插画', 'second.jpg'))).rejects.toThrow()
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})
