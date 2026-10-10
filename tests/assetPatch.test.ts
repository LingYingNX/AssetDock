import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryDb } from '../src/main/services/db'
import { closeAllLibHandles, ensureLibraryStorage, openLibDb } from '../src/main/services/libraryDb'
import { sanitizeAssetPatch, updateAsset, assetsByIds, upsertScanned, type ScanEntry } from '../src/main/services/store'
import type { LibraryRow, AssetRow } from '../src/shared/types'

let root: string
let libPath: string
let memDb: ReturnType<typeof openMemoryDb>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mediahub-assetpatch-'))
  libPath = join(root, 'lib')
  mkdirSync(libPath, { recursive: true })
  writeFileSync(join(libPath, 'a.jpg'), 'x')
})

afterEach(() => {
  closeAllLibHandles()
  memDb?.close()
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* Windows 句柄滞后 */ }
})

const entry = (relPath: string, fingerprint: string): ScanEntry => ({
  relPath,
  name: relPath.slice(0, relPath.lastIndexOf('.')),
  type: 'image' as const,
  format: 'JPG',
  sizeBytes: 1,
  mtimeMs: 1,
  fingerprint
})

function seedLibrary(name = '测试库'): { lib: LibraryRow; db: ReturnType<typeof openLibDb> } {
  memDb = openMemoryDb()
  memDb.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, name, libPath)
  const lib = memDb.prepare('SELECT * FROM libraries WHERE id = 1').get() as LibraryRow
  ensureLibraryStorage(memDb, { id: lib.id, name: lib.name, path: libPath })
  const db = openLibDb(libPath)
  return { lib, db }
}

function seedAsset(db: ReturnType<typeof openLibDb>, rel: string): AssetRow {
  upsertScanned(db, 1, [entry(rel, 'fp-' + rel)])
  return db.prepare('SELECT * FROM assets WHERE rel_path = ?').get(rel) as AssetRow
}

describe('sanitizeAssetPatch (S1-4)', () => {
  it('drops non-whitelisted keys', () => {
    const out = sanitizeAssetPatch({ rating: 3, evil: 'x' } as never)
    expect(out).toEqual({ rating: 3 })
  })

  it('drops type-violating values per column', () => {
    const out = sanitizeAssetPatch({
      rating: '5' as never,
      favorite: 1,
      review_flag: true as never,
      note: 42 as never,
      source_url: null,
      width: -3 as never,
      deleted_at: 'nope' as never
    })
    expect(out).toEqual({ favorite: 1, source_url: null })
  })

  it('keeps valid values including null sentinels', () => {
    const out = sanitizeAssetPatch({
      source_url: null,
      deleted_at: null,
      rating: 5,
      name: 'a.jpg',
      fps: null,
      duration: 12.5
    })
    expect(out).toEqual({
      source_url: null, deleted_at: null, rating: 5, name: 'a.jpg', fps: null, duration: 12.5
    })
  })

  it('updateAsset persists nothing when every value is invalid', () => {
    const { db } = seedLibrary()
    const row = seedAsset(db, 'a/b.jpg')
    updateAsset(db, row.id, { rating: 'nine' as never, favorite: true as never })
    const after = db.prepare('SELECT rating, favorite FROM assets WHERE id = ?').get(row.id) as
      { rating: number; favorite: number }
    expect(after.rating).toBe(0)
    expect(after.favorite).toBe(0)
  })

  it('updateAsset persists valid values round-trip', () => {
    const { db } = seedLibrary()
    const row = seedAsset(db, 'a/c.jpg')
    updateAsset(db, row.id, { rating: 4, note: '好的', favorite: 1 })
    const after = db.prepare('SELECT rating, note, favorite FROM assets WHERE id = ?').get(row.id) as
      { rating: number; note: string; favorite: number }
    expect(after.rating).toBe(4)
    expect(after.note).toBe('好的')
    expect(after.favorite).toBe(1)
  })

  it('assetsByIds still returns patched rows with tags join intact', () => {
    const { db } = seedLibrary()
    const row = seedAsset(db, 'x/y.jpg')
    updateAsset(db, row.id, { rating: 2 })
    const rows = assetsByIds(db, 1, [row.id])
    expect(rows).toHaveLength(1)
    expect(rows[0].rating).toBe(2)
  })
})
