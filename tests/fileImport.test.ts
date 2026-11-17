import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importDroppedFiles, normalizeDroppedPaths } from '../src/main/services/fileImport'
import { openMemoryLibDb } from '../src/main/services/libraryDb'
import { upsertScanned } from '../src/main/services/store'
import { thumbJobRows } from '../src/main/services/thumbs'

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
    await writeFile(join(root, 'note.pdf'), 'T')
    await writeFile(join(outside, 'a.jpg'), 'A')
    const result = await importDroppedFiles(root, '', [join(root, 'note.pdf'), join(outside, 'a.jpg')])
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('imports supported documents from outside the library', async () => {
    const source = join(outside, 'notes.txt')
    await writeFile(source, '中文笔记')
    const result = await importDroppedFiles(root, '', [source])
    expect(result).toMatchObject({ imported: 1, skipped: 0 })
    expect(result.entries[0]).toMatchObject({ relPath: 'notes.txt', type: 'document', format: 'TXT' })
  })

  it('imports standalone HTML as a document instead of skipping it', async () => {
    const source = join(outside, 'page.html')
    await writeFile(source, '<!doctype html><html><body><div class="card">HTML</div></body></html>')
    const result = await importDroppedFiles(root, '', [source])
    expect(result).toMatchObject({ imported: 1, skipped: 0 })
    expect(result.entries[0]).toMatchObject({ relPath: 'page.html', type: 'document', format: 'HTML' })
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

  it('does not eagerly rasterize imported SVG while retaining raster imports', async () => {
    await writeFile(
      join(outside, 'icon.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#39f"/></svg>'
    )
    await writeFile(
      join(outside, 'photo.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    )
    const db = openMemoryLibDb()
    try {
      const result = await importDroppedFiles(root, '', [join(outside, 'icon.svg'), join(outside, 'photo.png')])
      expect(result.imported).toBe(2)
      upsertScanned(db, 1, result.entries)

      const jobs = thumbJobRows(db, 1, result.entries.map((entry) => entry.fingerprint))
      expect(jobs.map((row) => row.rel_path)).toEqual(['photo.png'])
    } finally {
      db.close()
    }
  })
})
