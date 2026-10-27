import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importDroppedFiles, normalizeDroppedPaths } from '../src/main/services/fileImport'
import { openMemoryLibDb } from '../src/main/services/libraryDb'
import { upsertScanned } from '../src/main/services/store'

describe('file import', () => {
  let root = ''
  let outside = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mediahub-drop-'))
    outside = await mkdtemp(join(tmpdir(), 'mediahub-drop-outside-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('keeps unique supported external files and excludes library-internal sources', async () => {
    await mkdir(join(root, 'sub'))
    await writeFile(join(root, 'sub', 'a.jpg'), 'A')
    await writeFile(join(root, 'sub', 'skip.txt'), 'T')
    await writeFile(join(outside, 'outside.jpg'), 'O')
    const paths = [
      join(root, 'sub', 'a.jpg'),
      join(root, 'sub', 'a.jpg'),
      join(root, 'sub', 'skip.txt'),
      join(outside, 'outside.jpg')
    ]
    expect(normalizeDroppedPaths(paths, root)).toEqual([join(outside, 'outside.jpg')])
  })

  it('copies into the target folder without overwriting same-named files', async () => {
    const source = join(outside, 'source.jpg')
    await mkdir(join(root, 'target'))
    await writeFile(source, 'new')
    await writeFile(join(root, 'target', 'source.jpg'), 'existing')
    const result = await importDroppedFiles(root, 'target', [source])
    expect(result, JSON.stringify(result)).toMatchObject({ imported: 1 })
    expect(result.entries[0].relPath).toBe('target/source (2).jpg')
    await expect(readFile(join(root, 'target', 'source.jpg'), 'utf8')).resolves.toBe('existing')
    await expect(readFile(join(root, 'target', 'source (2).jpg'), 'utf8')).resolves.toBe('new')
  })

  it('numbers same-named files within one batch instead of clobbering', async () => {
    const one = join(outside, 'one')
    const two = join(outside, 'two')
    await mkdir(one)
    await mkdir(two)
    await writeFile(join(one, 'same.jpg'), 'one')
    await writeFile(join(two, 'same.jpg'), 'two')
    const result = await importDroppedFiles(root, '', [join(one, 'same.jpg'), join(two, 'same.jpg')])
    expect(result.entries.map((entry) => entry.relPath).sort()).toEqual(['same (2).jpg', 'same.jpg'])
    await expect(readFile(join(root, 'same.jpg'), 'utf8')).resolves.toBe('one')
    await expect(readFile(join(root, 'same (2).jpg'), 'utf8')).resolves.toBe('two')
  })

  it('imports external images while skipping unsupported and library-internal files', async () => {
    await writeFile(join(root, 'note.txt'), 'T')
    await writeFile(join(outside, 'a.jpg'), 'A')
    const result = await importDroppedFiles(root, '', [join(root, 'note.txt'), join(outside, 'a.jpg')])
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('rejects a target folder that junction-escapes the library root', async () => {
    await mkdir(join(root, 'ok'))
    const linked = join(root, 'linked')
    const { symlink } = await import('node:fs/promises')
    await symlink(outside, linked, 'junction')
    await writeFile(join(outside, 'a.jpg'), 'A')

    await expect(importDroppedFiles(root, 'linked', [join(outside, 'a.jpg')])).rejects.toThrow('目标文件夹')
  })

  it('hands scanned entries to upsertScanned with the imported relative path', async () => {
    const source = join(outside, 'theme.css')
    await writeFile(source, 'body { color: red; }')
    const db = openMemoryLibDb()
    try {
      const result = await importDroppedFiles(root, '', [source])
      expect(result.entries).toHaveLength(1)
      upsertScanned(db, 1, result.entries)
      const row = db.prepare('SELECT rel_path, format FROM assets WHERE library_id = 1').get() as
        { rel_path: string; format: string }
      expect(row).toEqual({ rel_path: 'theme.css', format: 'CSS' })
    } finally {
      db.close()
    }
  })
})
