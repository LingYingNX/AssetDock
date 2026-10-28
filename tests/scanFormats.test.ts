import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/services/formatProbe', () => ({
  probeImageMeta: vi.fn(async () => ({ width: 32, height: 24 }))
}))
vi.mock('../src/main/services/videoMeta', () => ({
  probeVideo: vi.fn(async () => ({ width: 32, height: 24, duration: 1, codec: 'h264', fps: 25 }))
}))

import { scanLibrary } from '../src/main/services/scan'
import { openMemoryLibDb } from '../src/main/services/libraryDb'
import { upsertScanned } from '../src/main/services/store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('scanning expanded formats', () => {
  it('registers new image, video and model extensions through the registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-scan-formats-'))
    roots.push(root)
    const names = [
      'poster.ai', 'art.psd', 'photo.heic', 'light.hdr', 'render.exr',
      'clip.mkv', 'scene.blend', 'model.c4d', 'girl.pmd', 'girl.pmx', 'photo.jpg'
    ]
    await Promise.all(names.map((name) => writeFile(join(root, name), name)))

    const entries = await scanLibrary(root)
    const byPath = new Map(entries.map((entry) => [entry.relPath, entry]))
    expect(entries).toHaveLength(names.length)
    expect(byPath.get('poster.ai')).toMatchObject({ type: 'image', format: 'AI', width: 32, height: 24 })
    expect(byPath.get('clip.mkv')).toMatchObject({ type: 'video', format: 'MKV', duration: 1 })
    expect(byPath.get('scene.blend')).toMatchObject({ type: 'model', format: 'BLEND' })
    expect(byPath.get('model.c4d')).toMatchObject({ type: 'model', format: 'C4D' })
    expect(byPath.get('girl.pmx')).toMatchObject({ type: 'model', format: 'PMX' })
    expect(byPath.get('photo.jpg')).toMatchObject({ type: 'image', format: 'JPG' })
  })

  it('registers documents through the same registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-scan-documents-'))
    roots.push(root)
    const names = ['notes.txt', 'README.md', 'data.csv', 'plan.docx', 'book.xlsx', 'deck.pptx', 'legacy.doc']
    await Promise.all(names.map((name) => writeFile(join(root, name), name)))

    const entries = await scanLibrary(root)
    const byPath = new Map(entries.map((entry) => [entry.relPath, entry]))
    expect(entries).toHaveLength(names.length)
    expect(byPath.get('notes.txt')).toMatchObject({ type: 'document', format: 'TXT' })
    expect(byPath.get('README.md')).toMatchObject({ type: 'document', format: 'MARKDOWN' })
    expect(byPath.get('data.csv')).toMatchObject({ type: 'document', format: 'CSV' })
    expect(byPath.get('plan.docx')).toMatchObject({ type: 'document', format: 'DOCX' })
    expect(byPath.get('book.xlsx')).toMatchObject({ type: 'document', format: 'XLSX' })
    expect(byPath.get('deck.pptx')).toMatchObject({ type: 'document', format: 'PPTX' })
    expect(byPath.get('legacy.doc')).toMatchObject({ type: 'document', format: 'DOC' })
  })

  it('stores canonical formats while preserving the original relative path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-scan-canonical-'))
    roots.push(root)
    await Promise.all(['photo.jpeg', 'scene.gltf', 'photo.heif'].map((name) => writeFile(join(root, name), name)))

    const entries = await scanLibrary(root)
    const db = openMemoryLibDb()
    try {
      upsertScanned(db, 1, entries)
      const rows = db
        .prepare('SELECT rel_path, name, type, format FROM assets ORDER BY rel_path')
        .all() as { rel_path: string; name: string; type: string; format: string }[]

      expect(rows).toEqual([
        { rel_path: 'photo.heif', name: 'photo', type: 'image', format: 'HEIC' },
        { rel_path: 'photo.jpeg', name: 'photo', type: 'image', format: 'JPG' },
        { rel_path: 'scene.gltf', name: 'scene', type: 'model', format: 'GLB' }
      ])
    } finally {
      db.close()
    }
  })
})
