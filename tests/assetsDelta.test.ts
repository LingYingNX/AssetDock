import { describe, expect, it, vi } from 'vitest'
import { openMemoryDb } from '../src/main/services/db'
import { assetsByIds, upsertScanned } from '../src/main/services/store'

const entry = (relPath: string, fingerprint: string, mtimeMs = 1) => ({
  relPath, name: relPath.slice(0, relPath.lastIndexOf('.')), type: 'image' as const, format: 'JPG', sizeBytes: 1, mtimeMs, fingerprint
})

describe('assetsByIds (S1-7 delta rows)', () => {
  it('returns only the requested ids of the requested library with tags', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', 'C:/one')
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(2, 'two', 'C:/two')
    const [a] = upsertScanned(db, 1, [entry('a.jpg', 'a')])
    const [b] = upsertScanned(db, 2, [entry('b.jpg', 'b')])
    // 标签 join 路径与全量查询一致
    db.prepare('INSERT INTO tags(id, name, color) VALUES (?, ?, ?)').run(1, 'nature', '#123456')
    db.prepare('INSERT INTO asset_tags(asset_id, tag_id) VALUES (?, ?)').run(a.assetId, 1)

    const rows = assetsByIds(db, 1, [a.assetId, b.assetId, 999])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(a.assetId)
    expect(rows[0].tags).toEqual([{ name: 'nature', color: '#123456' }])
    db.close()
  })

  it('deduplicates ids and returns nothing for empty or invalid input', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', 'C:/one')
    const [a] = upsertScanned(db, 1, [entry('a.jpg', 'a')])
    expect(assetsByIds(db, 1, [a.assetId, a.assetId])).toHaveLength(1)
    expect(assetsByIds(db, 1, [])).toEqual([])
    expect(assetsByIds(db, 1, [Number.NaN, 1.5, null as unknown as number])).toEqual([])
    db.close()
  })

  it('drops ids whose rows were hard-deleted instead of failing', () => {
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'one', 'C:/one')
    const [a] = upsertScanned(db, 1, [entry('a.jpg', 'a')])
    db.prepare('DELETE FROM assets WHERE id = ?').run(a.assetId)
    expect(assetsByIds(db, 1, [a.assetId])).toEqual([])
    db.close()
  })
})

describe('applyAssetDelta (S1-7 renderer merge)', () => {
  const baseAsset = (dbId: number, name: string, folders: string[] = []) => ({
    id: `a${dbId}`, dbId, libraryId: 1, type: 'image' as const, format: 'JPG' as const, name,
    sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0 as const, favorite: false,
    reviewFlag: false, tags: [], folders, note: '', palette: [], previewUrl: '', originalUrl: '', absPath: ''
  })

  it('merges updated rows by dbId and inserts new ones at the top', async () => {
    const rowsStub = vi.fn().mockResolvedValue({
      assets: [
        { id: 2, library_id: 1, rel_path: 'new/new.jpg', fingerprint: 'n1', type: 'image', format: 'JPG', name: 'new', size_bytes: 2, imported_at: '2026-09-06T00:00', rating: 0, favorite: 0, review_flag: 0, tags: [], palette: '[]' },
        { id: 1, library_id: 1, rel_path: 'one.jpg', fingerprint: 'f1', type: 'image', format: 'JPG', name: 'one-updated', size_bytes: 2, imported_at: '2026-09-05T00:00', rating: 5, favorite: 0, review_flag: 0, tags: [], palette: '[]' }
      ]
    })
    vi.stubGlobal('window', { windowApi: { assets: { rows: rowsStub } } })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 't1', name: 'L', libraryId: 1 }],
      activeTabId: 't1',
      physicalFolderPaths: ['existing'],
      folderPaths: ['existing'],
      assets: [baseAsset(1, 'one') as never]
    })

    useUI.getState().applyAssetDelta(1, [1, 2])
    await vi.waitFor(() => {
      const assets = useUI.getState().assets
      expect(assets).toHaveLength(2)
      expect(assets[0].dbId).toBe(2) // 新行插入表头
      expect(assets.find((a) => a.dbId === 1)?.name).toBe('one-updated')
      expect(assets.find((a) => a.dbId === 1)?.rating).toBe(5)
      // 新行带来的目录并入文件夹树并保持排序
      expect(useUI.getState().physicalFolderPaths).toEqual(['existing', 'new'])
    })
    vi.unstubAllGlobals()
  })

  it('removes assets named by the event but missing from the rows query', async () => {
    const rowsStub = vi.fn().mockResolvedValue({ assets: [] })
    vi.stubGlobal('window', { windowApi: { assets: { rows: rowsStub } } })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 't1', name: 'L', libraryId: 1 }],
      activeTabId: 't1',
      physicalFolderPaths: [],
      folderPaths: [],
      assets: [baseAsset(7, 'doomed') as never, baseAsset(8, 'keep') as never]
    })

    useUI.getState().applyAssetDelta(1, [7])
    await vi.waitFor(() => {
      expect(useUI.getState().assets.map((a) => a.dbId)).toEqual([8])
    })
    vi.unstubAllGlobals()
  })

  it('falls back to full reload when no ids or a foreign library event arrives', async () => {
    vi.stubGlobal('window', { windowApi: { assets: { rows: vi.fn() } } })
    const { useUI } = await import('../src/renderer/src/store/ui')
    const reload = vi.fn()
    useUI.setState({
      tabs: [{ id: 't1', name: 'L', libraryId: 1 }],
      activeTabId: 't1',
      reloadActiveLibrary: reload
    })

    useUI.getState().applyAssetDelta(1, [])
    useUI.getState().applyAssetDelta(1, undefined)
    useUI.getState().applyAssetDelta(2, [5]) // 非活动库:忽略
    expect(reload).toHaveBeenCalledTimes(2)
    expect(vi.mocked(window.windowApi.assets.rows).mock.calls).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('falls back to full reload when the delta query rejects', async () => {
    vi.stubGlobal('window', {
      windowApi: { assets: { rows: vi.fn().mockRejectedValue(new Error('ipc down')) } }
    })
    const { useUI } = await import('../src/renderer/src/store/ui')
    const reload = vi.fn()
    useUI.setState({
      tabs: [{ id: 't1', name: 'L', libraryId: 1 }],
      activeTabId: 't1',
      reloadActiveLibrary: reload
    })

    useUI.getState().applyAssetDelta(1, [9])
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    vi.unstubAllGlobals()
  })
})
