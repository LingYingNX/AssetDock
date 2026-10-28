import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryDb } from '../src/main/services/db'
import { upsertScanned } from '../src/main/services/store'
import {
  removeThumbsIfUnused,
  resetThumbCache,
  thumbJobRows,
  thumbPath,
  thumbsDir
} from '../src/main/services/thumbs'

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false)

describe('thumbnail database selection', () => {
  let root = ''
  let db: ReturnType<typeof openMemoryDb>

  beforeEach(async () => {
    resetThumbCache()
    root = await mkdtemp(join(tmpdir(), 'mediahub-thumbs-db-'))
    db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'lib', root)
  })
  afterEach(async () => {
    db.close()
    resetThumbCache()
    await rm(root, { recursive: true, force: true })
  })

  it('selects eager covers while excluding SVG, trash and missing; fingerprint scope narrows jobs', () => {
    const add = (relPath: string, type: string, format: string, fingerprint: string) =>
      upsertScanned(db, 1, [{ relPath, name: relPath.replace(/\.[^.]+$/, ''), type: type as never, format, sizeBytes: 10, mtimeMs: 1, fingerprint }])
    add('photo.png', 'image', 'PNG', 'fp-img')
    add('icon.svg', 'image', 'SVG', 'fp-svg')
    add('loader.css', 'style', 'CSS', 'fp-css')
    add('clip.mp4', 'video', 'MP4', 'fp-vid')
    add('model.glb', 'model', 'GLB', 'fp-model')
    add('trashed.png', 'image', 'PNG', 'fp-trash')
    db.prepare("UPDATE assets SET deleted_at = '2026-09-27T00:00:00.000Z' WHERE fingerprint = 'fp-trash'").run()

    expect(thumbJobRows(db, 1).map((row) => row.rel_path).sort()).toEqual([
      'clip.mp4', 'loader.css', 'model.glb', 'photo.png'
    ])
    expect(thumbJobRows(db, 1, ['fp-img']).map((row) => row.rel_path)).toEqual(['photo.png'])
    expect(thumbJobRows(db, 1, ['fp-svg'])).toEqual([])
  })

  const entry = (relPath: string) => ({
    relPath,
    name: relPath.slice(0, relPath.lastIndexOf('.')),
    type: 'image' as const,
    format: 'JPG',
    sizeBytes: 1,
    mtimeMs: 1,
    fingerprint: 'fp-shared'
  })

  const seedTwoAssetsOnOneThumb = async () => {
    const [a, b] = upsertScanned(db, 1, [entry('a.jpg'), entry('b.jpg')])
    await mkdir(thumbsDir(root), { recursive: true })
    await writeFile(thumbPath(root, 'fp-shared'), 'cached')
    return { a, b }
  }

  it('keeps a thumbnail while another live asset shares the fingerprint', async () => {
    const { a } = await seedTwoAssetsOnOneThumb()
    db.prepare('UPDATE assets SET deleted_at = ? WHERE id = ?').run('2026-01-01', a.assetId)
    expect(await removeThumbsIfUnused(root, db, 1, ['fp-shared'])).toBe(0)
    expect(await exists(thumbPath(root, 'fp-shared'))).toBe(true)
  })

  it('removes a thumbnail once no live asset references the fingerprint', async () => {
    const { a, b } = await seedTwoAssetsOnOneThumb()
    db.prepare('UPDATE assets SET deleted_at = ? WHERE id IN (?, ?)').run('2026-01-01', a.assetId, b.assetId)
    expect(await removeThumbsIfUnused(root, db, 1, ['fp-shared'])).toBe(1)
    expect(await exists(thumbPath(root, 'fp-shared'))).toBe(false)
  })
})
