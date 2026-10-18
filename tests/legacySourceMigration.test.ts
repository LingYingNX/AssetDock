import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateLegacySources } from '../src/main/services/legacySourceMigration'
import { openMemoryLibDb } from '../src/main/services/libraryDb'
import { addTag, assetById, updateAsset } from '../src/main/services/store'

describe('legacy source migration', () => {
  it('moves registered originals into the library and keeps the asset metadata', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'mediahub-legacy-source-'))
    const source = join(parent, 'external')
    const library = join(parent, 'library')
    await mkdir(join(source, 'nested'), { recursive: true })
    await mkdir(join(library, '.mediahub', 'metadata', '7'), { recursive: true })
    await writeFile(join(source, 'nested', 'asset.jpg'), 'original')
    await writeFile(join(library, '.mediahub', 'metadata', '7', 'asset.jpg.json'), '{}')
    const db = openMemoryLibDb()
    try {
      db.prepare("INSERT INTO index_sources(id, path, name) VALUES (7, ?, 'external')").run(source)
      const asset = Number(db.prepare("INSERT INTO assets(library_id, rel_path, name, type, format, size_bytes, mtime_ms, fingerprint, imported_at, source_index_id) VALUES (1, '@index:7/nested/asset.jpg', 'asset', 'image', 'JPG', 8, 1, 'asset', '2026-09-10T00:00', 7)").run().lastInsertRowid)
      db.prepare("INSERT INTO assets(library_id, rel_path, name, type, format, size_bytes, mtime_ms, fingerprint, imported_at, source_index_id, missing) VALUES (1, '@index:7/missing.jpg', 'missing', 'image', 'JPG', 1, 1, 'missing', '2026-09-10T00:00', 7, 1)").run()
      addTag(db, 1, asset, 'keep')
      updateAsset(db, 1, asset, { note: 'keep note', rating: 5, favorite: 1, source_url: 'https://example.test/asset' })

      await expect(migrateLegacySources(db, 1, library)).resolves.toEqual({ moved: 1, removedMissing: 1, sourceIds: [7] })

      await expect(access(join(source, 'nested', 'asset.jpg'))).rejects.toThrow()
      await expect(access(join(library, 'nested', 'asset.jpg'))).resolves.toBeUndefined()
      await expect(access(join(library, '.mediahub', 'metadata', '7'))).rejects.toThrow()
      expect(db.prepare('SELECT * FROM index_sources').all()).toEqual([])
      expect(assetById(db, 1, asset)).toMatchObject({
        rel_path: 'nested/asset.jpg', note: 'keep note', rating: 5, favorite: 1,
        source_url: 'https://example.test/asset', tags: [{ name: 'keep', color: expect.any(String) }]
      })
      expect(db.prepare('SELECT source_index_id FROM assets WHERE id = ?').get(asset)).toEqual({ source_index_id: null })
      expect(db.prepare('SELECT id FROM assets WHERE name = ?').all('missing')).toEqual([])
    } finally {
      db.close()
      await rm(parent, { recursive: true, force: true })
    }
  })
})
