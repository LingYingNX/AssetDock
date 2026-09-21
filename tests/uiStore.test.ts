import { describe, expect, it, vi } from 'vitest'
import { queryAssets, DEFAULT_FILTERS } from '../src/renderer/src/data/query'

describe('UI store', () => {
  it('creates media URLs from the local library path', async () => {
    vi.stubGlobal('window', { windowApi: {} })
    const { rowToAsset } = await import('../src/renderer/src/store/ui')
    const asset = rowToAsset({
      id: 3,
      library_id: 7,
      rel_path: 'same.jpg',
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

    expect(asset.previewUrl).toBe('media://7/same.jpg?v=fp')
    expect(asset.originalUrl).toBe(asset.previewUrl)
  })

  it('uses the local path for asset classification', async () => {
    vi.stubGlobal('window', { windowApi: {} })
    const { rowToAsset } = await import('../src/renderer/src/store/ui')
    const asset = rowToAsset({
      id: 4,
      library_id: 7,
      rel_path: 'target/child/reference/same.jpg',
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

    expect(asset.folders).toEqual(['target', 'target/child', 'target/child/reference'])
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

  it('moves assets without changing the active view and refreshes the library', async () => {
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
      expect(useUI.getState().nav).toBe('folder:target')
      expect(reload).toHaveBeenCalled()
    })
  })

  it('updates the folder tree immediately while a folder move is pending', async () => {
    let resolveMove: (value: { path: string }) => void = () => {}
    const pending = new Promise<{ path: string }>((resolve) => { resolveMove = resolve })
    const move = vi.fn(() => pending)
    const reload = vi.fn()
    vi.stubGlobal('window', { windowApi: { folders: { move } } })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 'library-1', name: 'Library', libraryId: 1 }],
      activeTabId: 'library-1',
      nav: 'folder:source',
      folderPaths: ['source', 'target', 'target/existing'],
      physicalFolderPaths: ['source', 'target', 'target/existing'],
      assets: [],
      reloadActiveLibrary: reload
    })

    useUI.getState().moveFolder('source', 'target', 'inside')

    expect(useUI.getState().folderPaths).toEqual(['target', 'target/existing', 'target/source'])
    expect(useUI.getState().physicalFolderPaths).toEqual(['target', 'target/existing', 'target/source'])
    expect(useUI.getState().nav).toBe('folder:target/source')
    expect(move).toHaveBeenCalledWith(1, 'source', 'target', 'inside')
    expect(reload).not.toHaveBeenCalled()

    resolveMove({ path: 'target/source' })
    await vi.waitFor(() => expect(reload).toHaveBeenCalled())
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

  it('creates a library with the name and directory supplied by the dialog', async () => {
    const create = vi.fn().mockResolvedValue({ id: 3, name: '设计素材库', path: 'C:/Libraries/Design' })
    vi.stubGlobal('window', { windowApi: { library: { create } } })
    const { useUI } = await import('../src/renderer/src/store/ui')
    const openLibrary = vi.fn()
    useUI.setState({ libraries: [], openLibrary })

    await useUI.getState().createLibraryFlow('设计素材库', 'C:/Libraries/Design')

    expect(create).toHaveBeenCalledWith('C:/Libraries/Design', '设计素材库')
    expect(openLibrary).toHaveBeenCalledWith(3, '设计素材库')
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

  it('reports an Eagle import failure instead of silently rejecting', async () => {
    const alert = vi.fn()
    vi.stubGlobal('alert', alert)
    vi.stubGlobal('window', {
      windowApi: {
        pickFolder: vi.fn().mockResolvedValue('E:/图.library'),
        library: { importEagle: vi.fn().mockRejectedValue(new Error('IPC unavailable')) }
      }
    })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 'library-1', name: 'Library', libraryId: 1 }],
      activeTabId: 'library-1',
      scanProgress: null
    })

    useUI.getState().importEagleFlow()

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith('导入 Eagle 素材失败: IPC unavailable'))
    expect(useUI.getState().scanProgress).toBeNull()
  })
})

describe('restoreUiPrefs', () => {
  const load = async (stored: string | null) => {
    const set = vi.fn()
    vi.resetModules()
    vi.stubGlobal('window', {
      windowApi: { state: { get: async () => stored, set: async () => ({ ok: true }) } }
    })
    const mod = await import('../src/renderer/src/store/ui')
    // 用真实 store 的状态断言:恢复函数应直接 setState 到 store
    await mod.restoreUiPrefs()
    void set
    return mod.useUI.getState()
  }

  it('applies every stored preference', async () => {
    const s = await load(JSON.stringify({ view: 'list', colw: 300, inspHidden: true, cbarOpen: true }))
    expect(s.view).toBe('list')
    expect(s.colw).toBe(300)
    expect(s.inspHidden).toBe(true)
    expect(s.cbarOpen).toBe(true)
  })

  it('falls back to defaults when nothing is stored', async () => {
    const s = await load(null)
    expect(s.view).toBe('waterfall')
    expect(s.colw).toBe(232)
    expect(s.inspHidden).toBe(false)
    expect(s.cbarOpen).toBe(false)
  })

  it('ignores malformed JSON instead of throwing', async () => {
    const s = await load('{not json')
    expect(s.view).toBe('waterfall')
    expect(s.colw).toBe(232)
  })

  it('rejects out-of-range and unknown values field by field', async () => {
    const s = await load(JSON.stringify({ view: 'diagonal', colw: 9999, inspHidden: 'yes', cbarOpen: 1 }))
    expect(s.view).toBe('waterfall')
    expect(s.colw).toBe(320)
    expect(s.inspHidden).toBe(false)
    expect(s.cbarOpen).toBe(false)
  })
})
