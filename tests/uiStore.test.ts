import { describe, expect, it, vi } from 'vitest'
import { queryAssets, DEFAULT_FILTERS } from '../src/renderer/src/data/query'

describe('UI store', () => {
  it('carries the index identity in media URLs', async () => {
    vi.stubGlobal('window', { windowApi: {} })
    const { rowToAsset } = await import('../src/renderer/src/store/ui')
    const asset = rowToAsset({
      id: 3,
      library_id: 7,
      rel_path: '@index:4/same.jpg',
      source_index_id: 4,
      fingerprint: 'fp',
      type: 'image',
      format: 'JPG',
      name: 'same',
      size_bytes: 1,
      imported_at: '2026-09-05T00:00',
      rating: 0,
      favorite: 0,
      review_flag: 0,
      tags: [],
      palette: '[]'
    })

    expect(asset.originalUrl).toBe('media://7/%40index%3A4%2Fsame.jpg?source=4')
  })

  it('uses the assigned folder for indexed asset classification', async () => {
    vi.stubGlobal('window', { windowApi: {} })
    const { rowToAsset } = await import('../src/renderer/src/store/ui')
    const asset = rowToAsset({
      id: 4,
      library_id: 7,
      rel_path: '@index:2/1/reference/same.jpg',
      source_index_id: 2,
      folder_path: 'target/child',
      fingerprint: 'fp',
      type: 'image',
      format: 'JPG',
      name: 'same',
      size_bytes: 1,
      imported_at: '2026-09-05T00:00',
      rating: 0,
      favorite: 0,
      review_flag: 0,
      tags: [],
      palette: '[]'
    })

    expect(asset.folders).toEqual(['target', 'target/child'])
    expect(queryAssets([asset], {
      nav: 'folder:target',
      search: '',
      filters: DEFAULT_FILTERS,
      swatches: [],
      stripColor: null
    })).toEqual([asset])
  })

  it('reloads before reporting a partially completed move', async () => {
    const calls: string[] = []
    vi.stubGlobal('alert', (message: string) => calls.push(`alert:${message}`))
    vi.stubGlobal('window', {
      windowApi: {
        assets: {
          move: vi.fn().mockResolvedValue({ error: 'second asset failed', moved: 1 })
        }
      }
    })
    const { useUI } = await import('../src/renderer/src/store/ui')
    const reload = vi.fn(() => calls.push('reload'))
    useUI.setState({
      tabs: [{ id: 'library-1', name: 'Library', libraryId: 1 }],
      activeTabId: 'library-1',
      assets: [
        { id: 'a1', dbId: 1, libraryId: 1, type: 'image', format: 'JPG', name: 'one', sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0, favorite: false, reviewFlag: false, tags: [], folders: [], note: '', palette: [], previewUrl: '', originalUrl: '', absPath: '' },
        { id: 'a2', dbId: 2, libraryId: 1, type: 'image', format: 'JPG', name: 'two', sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0, favorite: false, reviewFlag: false, tags: [], folders: [], note: '', palette: [], previewUrl: '', originalUrl: '', absPath: '' }
      ],
      reloadActiveLibrary: reload
    })

    useUI.getState().moveAssetsToFolder(['a1', 'a2'], 'target')
    await vi.waitFor(() => expect(calls).toEqual(['reload', 'alert:second asset failed']))
  })

  it('moves assets to untagged and refreshes the active library', async () => {
    const move = vi.fn().mockResolvedValue({ moved: 1 })
    const reload = vi.fn()
    vi.stubGlobal('window', { windowApi: { assets: { move } } })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 'library-1', name: 'Library', libraryId: 1 }],
      activeTabId: 'library-1',
      nav: 'folder:target',
      assets: [{ id: 'a1', dbId: 1, libraryId: 1, type: 'image', format: 'JPG', name: 'one', sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0, favorite: false, reviewFlag: false, tags: [], folders: ['target'], note: '', palette: [], previewUrl: '', originalUrl: '', absPath: '' }],
      reloadActiveLibrary: reload
    })

    useUI.getState().moveAssetsToFolder(['a1'], '')

    await vi.waitFor(() => {
      expect(move).toHaveBeenCalledWith(1, [1], '')
      expect(useUI.getState().nav).toBe('untagged')
      expect(reload).toHaveBeenCalled()
    })
  })

  it('shows the storage fallback warning after creating a library', async () => {
    const alert = vi.fn()
    vi.stubGlobal('alert', alert)
    vi.stubGlobal('window', {
      windowApi: {
        pickFolder: vi.fn().mockResolvedValue('C:/Library'),
        library: {
          create: vi.fn().mockResolvedValue({
            id: 2,
            name: 'Library',
            path: 'C:/Library',
            warning: '素材库无法创建本地数据库，当前会话将使用全局回退数据'
          })
        }
      }
    })
    const { useUI } = await import('../src/renderer/src/store/ui')
    const openLibrary = vi.fn()
    useUI.setState({ libraries: [], openLibrary })

    useUI.getState().createLibraryFlow()

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('素材库无法创建本地数据库，当前会话将使用全局回退数据'))
    expect(openLibrary).toHaveBeenCalledWith(2, 'Library')
  })

  it('selects the current filtered view with Ctrl+A action', async () => {
    vi.stubGlobal('window', { windowApi: {} })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      nav: 'folder:人物',
      assets: [
        { id: 'root', type: 'image', format: 'JPG', name: 'root', sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0, favorite: false, tags: [], folders: [], note: '', palette: [] },
        { id: 'foldered', type: 'image', format: 'JPG', name: 'foldered', sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0, favorite: false, tags: [], folders: ['人物'], note: '', palette: [] }
      ]
    })

    useUI.getState().selectAllVisible()

    expect(useUI.getState().selectedIds).toEqual(['foldered'])
  })
})
