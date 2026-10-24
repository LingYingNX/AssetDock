import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeAllLibHandles, openLibDb } from '../src/main/services/libraryDb'
import { addTag, assetById, updateAsset, upsertScanned } from '../src/main/services/store'

const roots: string[] = []

afterEach(async () => {
  closeAllLibHandles()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('shared metadata for expanded formats', () => {
  it('persists rating, tags, source, note, favorite and trash across restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-expanded-meta-'))
    roots.push(root)
    const first = openLibDb(root)
    const inserted = upsertScanned(first, 1, [
      { relPath: 'design/poster.ai', name: 'poster', type: 'image', format: 'AI', sizeBytes: 10, mtimeMs: 1, fingerprint: 'a' },
      { relPath: 'models/girl.pmx', name: 'girl', type: 'model', format: 'PMX', sizeBytes: 20, mtimeMs: 1, fingerprint: 'b' },
      { relPath: 'scenes/room.blend', name: 'room', type: 'model', format: 'BLEND', sizeBytes: 30, mtimeMs: 1, fingerprint: 'c' }
    ])

    for (const asset of inserted) {
      expect(updateAsset(first, 1, asset.assetId, {
        rating: 4,
        favorite: 1,
        note: `备注-${asset.assetId}`,
        source_url: `https://example.test/${asset.assetId}`,
        deleted_at: '2026-10-23T10:00:00.000Z'
      })).toBe(true)
      expect(addTag(first, 1, asset.assetId, '共用标签')).toBe(true)
    }
    first.close()

    const reopened = openLibDb(root)
    try {
      for (const asset of inserted) {
        expect(assetById(reopened, 1, asset.assetId)).toMatchObject({
          format: asset.relPath.endsWith('.ai') ? 'AI' : asset.relPath.endsWith('.pmx') ? 'PMX' : 'BLEND',
          rating: 4,
          favorite: 1,
          note: `备注-${asset.assetId}`,
          source_url: `https://example.test/${asset.assetId}`,
          deleted_at: '2026-10-23T10:00:00.000Z',
          tags: [{ name: '共用标签' }]
        })
      }
    } finally {
      reopened.close()
    }
  })
})
