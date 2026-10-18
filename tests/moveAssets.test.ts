import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../src/main/services/db'
import { addTag, applyMovedAssets, assetById, upsertScanned } from '../src/main/services/store'

const entry = (relPath: string, fingerprint: string) => ({
  relPath,
  name: relPath.replace(/\.[^.]+$/, ''),
  type: 'image' as const,
  format: 'JPG',
  sizeBytes: 1,
  mtimeMs: 1,
  fingerprint
})

describe('applyMovedAssets', () => {
  it('commits the successfully moved subset and preserves user metadata', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', 'C:/one')
    const [a, b] = upsertScanned(db, 1, [entry('from/a.jpg', 'a'), entry('from/b.jpg', 'b')])
    addTag(db, 1, a.assetId, 'keep')
    db.prepare('UPDATE assets SET rating = 5 WHERE id = ?').run(a.assetId)

    const moved = applyMovedAssets(db, 1, [
      { id: a.assetId, rel_path: 'from/a.jpg', fingerprint: 'a' }
    ], new Map([[a.assetId, 'to/a.jpg']]))

    expect(moved).toBe(1)
    expect(assetById(db, 1, a.assetId)).toMatchObject({
      rel_path: 'to/a.jpg',
      rating: 5,
      tags: [{ name: 'keep' }]
    })
    expect(assetById(db, 1, b.assetId)?.rel_path).toBe('from/b.jpg')
    db.close()
  })
})
