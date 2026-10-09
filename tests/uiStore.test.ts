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

    // 原图 URL 不带 thumb;卡片预览 URL 指向缩略图缓存
    expect(asset.originalUrl).toBe('media://7/same.jpg?v=fp')
    expect(asset.previewUrl).toBe('media://7/same.jpg?v=fp&thumb=1')
  })
  it('does not request thumbnails for assets already in the trash', async () => {
    vi.stubGlobal('window', { windowApi: {} })
    const { rowToAsset } = await import('../src/renderer/src/store/ui')
    const asset = rowToAsset({
      id: 5,
      library_id: 7,
      rel_path: 'trashed.jpg',
      fingerprint: 'fp',
      type: 'image',
      format: 'JPG',
      name: 'trashed',
      size_bytes: 1,
      imported_at: '2026-09-05T00:00',
      rating: 0,
      favorite: 0,
      review_flag: 0,
      tags: [],
      palette: '[]',
      deleted_at: '2026-09-27T00:00:00.000Z'
    })

    // 回收站素材的缩略图已清理,预览必须回退原图,否则 media:// 会把缓存写回来
    expect(asset.originalUrl).toBe('media://7/trashed.jpg?v=fp')
    expect(asset.previewUrl).toBe('media://7/trashed.jpg?v=fp')
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

  it('replaces the selection on a plain click, extends it with shift and toggles with ctrl', async () => {
    vi.stubGlobal('window', { windowApi: {} })
    const { useUI } = await import('../src/renderer/src/store/ui')
    const asset = (id: string) => ({ id, type: 'image', format: 'JPG', name: id, sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0, favorite: false, tags: [], folders: [], note: '', palette: [] })
    const order = ['a', 'b', 'c']
    useUI.setState({ nav: 'all', assets: [asset('a'), asset('b'), asset('c')] })

    // 无修饰键是单选:上一次的选中被替换,不再是累加
    useUI.getState().clickCard('a', { order })
    expect(useUI.getState().selectedIds).toEqual(['a'])
    useUI.getState().clickCard('b', { order })
    expect(useUI.getState().selectedIds).toEqual(['b'])
    expect(useUI.getState().activeId).toBe('b')
    expect(useUI.getState().focusedCardId).toBe('b')

    // Shift 从锚点重算区间并整体替换;锚点不动,所以再 Shift 能收窄
    useUI.getState().clickCard('a', { order })
    useUI.getState().clickCard('c', { order, shift: true })
    expect(useUI.getState().selectedIds).toEqual(['a', 'b', 'c'])
    useUI.getState().clickCard('b', { order, shift: true })
    expect(useUI.getState().selectedIds).toEqual(['a', 'b'])

    // Ctrl/Cmd 逐张切换:只翻转目标卡,其余保持
    useUI.getState().clickCard('c', { order, toggle: true })
    expect(useUI.getState().selectedIds).toEqual(['a', 'b', 'c'])
    useUI.getState().clickCard('c', { order, toggle: true })
    expect(useUI.getState().selectedIds).toEqual(['a', 'b'])
  })

  it('single-selects the target without building an order list (right-click and Space)', async () => {
    vi.stubGlobal('window', { windowApi: {} })
    const { useUI } = await import('../src/renderer/src/store/ui')
    const asset = (id: string) => ({ id, type: 'image', format: 'JPG', name: id, sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0, favorite: false, tags: [], folders: [], note: '', palette: [] })
    useUI.setState({ nav: 'all', assets: [asset('a'), asset('b'), asset('c')] })

    useUI.getState().setSelectedIds(['a', 'b'])
    useUI.getState().selectOnly('c')

    expect(useUI.getState().selectedIds).toEqual(['c'])
    expect(useUI.getState().selectionAnchorId).toBe('c')
    expect(useUI.getState().activeId).toBe('c')
    expect(useUI.getState().focusedCardId).toBe('c')
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
  // 桩按 key 返回:restoreUiPrefs 现在并行读 uiPrefs 与 preferences(主题段见文件末尾)
  const load = async (stored: string | null) => {
    vi.resetModules()
    vi.stubGlobal('window', {
      windowApi: {
        state: { get: async (key: string) => (key === 'uiPrefs' ? stored : null), set: async () => ({ ok: true }) }
      }
    })
    const mod = await import('../src/renderer/src/store/ui')
    // 用真实 store 的状态断言:恢复函数应直接 setState 到 store
    await mod.restoreUiPrefs()
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

describe('restoreUiPrefs: 导航记忆', () => {
  const loadNav = async (stored: string | null) => {
    vi.resetModules()
    vi.stubGlobal('window', {
      windowApi: {
        state: { get: async (key: string) => (key === 'uiPrefs' ? stored : null), set: async () => ({ ok: true }) }
      }
    })
    const mod = await import('../src/renderer/src/store/ui')
    await mod.restoreUiPrefs()
    return mod.useUI.getState().nav
  }

  it('restores a folder nav key', async () => {
    await expect(loadNav(JSON.stringify({ nav: 'folder:壁纸图/壁纸' }))).resolves.toBe('folder:壁纸图/壁纸')
  })

  it('restores simple and tag nav keys', async () => {
    await expect(loadNav(JSON.stringify({ nav: 'fav' }))).resolves.toBe('fav')
    await expect(loadNav(JSON.stringify({ nav: 'tag:参考' }))).resolves.toBe('tag:参考')
  })

  it('falls back to all for unknown or malformed nav values', async () => {
    await expect(loadNav(JSON.stringify({ nav: 'nonsense' }))).resolves.toBe('all')
    await expect(loadNav(JSON.stringify({ nav: 'folder:' }))).resolves.toBe('all')
    await expect(loadNav(JSON.stringify({ nav: 42 }))).resolves.toBe('all')
    await expect(loadNav(JSON.stringify({}))).resolves.toBe('all')
  })
})
describe('restoreUiPrefs: 主题引导', () => {
  /** 伪造最小 DOM + localStorage:theme.ts 只用 documentElement 属性、matchMedia 与 localStorage */
  const loadTheme = async (stored: Record<string, string | null>) => {
    vi.resetModules()
    const attrs: Record<string, string> = {}
    const doc = {
      documentElement: {
        setAttribute: (k: string, v: string): void => { attrs[k] = v },
        removeAttribute: (k: string): void => { delete attrs[k] },
        getAttribute: (k: string): string | null => attrs[k] ?? null
      }
    }
    const setItem = vi.fn((_k: string, _v: string): void => {})
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', {
      document: doc,
      localStorage: {
        getItem: (key: string): string | null => (stored[key] ?? null),
        setItem
      },
      matchMedia: () => ({ matches: true }),
      windowApi: {
        state: { get: async (key: string) => (stored[key] ?? null), set: async () => ({ ok: true }) }
      }
    })
    const mod = await import('../src/renderer/src/store/ui')
    await mod.restoreUiPrefs()
    return { attrs, setItem, state: mod.useUI.getState() }
  }

  it('applies the saved theme even when no uiPrefs are stored', async () => {
    // 旧实现里 uiPrefs 缺失会整段 return,连主题一起跳过  这里锁住拆分后的行为
    const { attrs, setItem } = await loadTheme({ preferences: JSON.stringify({ theme: 'dark' }) })
    expect(attrs['data-theme']).toBe('dark')
    expect(setItem).toHaveBeenCalledWith('mediahub.theme', 'dark')
  })

  it('keeps the attribute absent for light and still writes the mirror', async () => {
    const { attrs, setItem } = await loadTheme({ preferences: JSON.stringify({ theme: 'light' }) })
    expect(attrs['data-theme']).toBeUndefined()
    expect(setItem).toHaveBeenCalledWith('mediahub.theme', 'light')
  })

  it('restores hover playback when uiPrefs are missing', async () => {
    const { state } = await loadTheme({ preferences: JSON.stringify({ hoverVideo: false, hoverSound: true }) })
    expect(state.hoverVideo).toBe(false)
    expect(state.hoverSound).toBe(true)
  })

  it('does not overwrite the first-paint mirror when the preferences read fails', async () => {
    vi.resetModules()
    const attrs: Record<string, string> = { 'data-theme': 'dark' }
    const setItem = vi.fn()
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (key: string, value: string): void => { attrs[key] = value },
        removeAttribute: (key: string): void => { delete attrs[key] },
        getAttribute: (key: string): string | null => attrs[key] ?? null
      }
    })
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string): string | null => key === 'mediahub.theme' ? 'dark' : null,
        setItem
      },
      matchMedia: () => ({ matches: true }),
      windowApi: {
        state: {
          get: async (): Promise<string> => { throw new Error('IPC unavailable') },
          set: async () => ({ ok: true })
        }
      }
    })
    const mod = await import('../src/renderer/src/store/ui')
    await expect(mod.restoreUiPrefs()).resolves.toBeUndefined()
    expect(attrs['data-theme']).toBe('dark')
    expect(setItem).not.toHaveBeenCalled()
  })
})
