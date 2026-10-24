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
    expect(asset.previewUrl).toBe('media://7/same.jpg?v=fp&thumb=1&tv=3')
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
      stripColor: null
    })).toEqual([asset])
  })

  it('reloads before reporting a partially completed move', async () => {
    const calls: string[] = []
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      windowApi: {
        assets: {
          move: vi.fn().mockResolvedValue({ error: 'second asset failed', moved: 1 })
        }
      }
    })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      toast: null,
      showToast: (text: string) => calls.push(`alert:${text}`),
      tabs: [{ id: 'library-1', name: 'Library', libraryId: 1 }],
      activeTabId: 'library-1',
      assets: [
        { id: 'a1', dbId: 1, libraryId: 1, type: 'image', format: 'JPG', name: 'one', sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0, favorite: false, reviewFlag: false, tags: [], folders: [], note: '', palette: [], previewUrl: '', originalUrl: '', absPath: '' },
        { id: 'a2', dbId: 2, libraryId: 1, type: 'image', format: 'JPG', name: 'two', sizeBytes: 1, importedAt: '2026-09-05T00:00', rating: 0, favorite: false, reviewFlag: false, tags: [], folders: [], note: '', palette: [], previewUrl: '', originalUrl: '', absPath: '' }
      ],
      reloadActiveLibrary: vi.fn(() => calls.push('reload'))
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
    const toasts: string[] = []
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
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
    useUI.setState({ toast: null, showToast: (text: string) => toasts.push(text), libraries: [], openLibrary })

    useUI.getState().createLibraryFlow()

    await vi.waitFor(() => expect(toasts).toEqual(['素材库无法创建本地数据库，当前会话将使用全局回退数据']))
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
    const toasts: string[] = []
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      windowApi: {
        pickFolder: vi.fn().mockResolvedValue('E:/图.library'),
        library: { importEagle: vi.fn().mockRejectedValue(new Error('IPC unavailable')) }
      }
    })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      toast: null,
      showToast: (text: string) => toasts.push(text),
      tabs: [{ id: 'library-1', name: 'Library', libraryId: 1 }],
      activeTabId: 'library-1',
      scanProgress: null
    })

    useUI.getState().importEagleFlow()

    await vi.waitFor(() => expect(toasts).toEqual(['导入 Eagle 素材失败: IPC unavailable']))
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
    const s = await load(
      JSON.stringify({
        view: 'list',
        colw: 300,
        inspHidden: true,
        cbarOpen: true,
        modelShade: 'render',
        modelHdr: 'sunset',
        modelHdrRotation: 45,
        modelHdrStrength: 2,
        modelHdrOpacity: 0.3,
        modelHdrBlur: 0.8
      })
    )
    expect(s.view).toBe('list')
    expect(s.colw).toBe(300)
    expect(s.inspHidden).toBe(true)
    expect(s.cbarOpen).toBe(true)
    expect(s.modelShade).toBe('render')
    expect(s.modelHdr).toBe('sunset')
    expect(s.modelHdrRotation).toBe(45)
    expect(s.modelHdrStrength).toBe(2)
    expect(s.modelHdrOpacity).toBe(0.3)
    expect(s.modelHdrBlur).toBe(0.8)
  })

  it('falls back to defaults when nothing is stored', async () => {
    const s = await load(null)
    expect(s.view).toBe('waterfall')
    expect(s.colw).toBe(232)
    expect(s.inspHidden).toBe(false)
    expect(s.cbarOpen).toBe(false)
    expect(s.modelShade).toBe('solid')
    expect(s.modelHdr).toBe('forest')
    expect(s.modelHdrRotation).toBe(0)
    expect(s.modelHdrStrength).toBe(1)
    expect(s.modelHdrOpacity).toBe(0)
    expect(s.modelHdrBlur).toBe(0.5)
  })

  it('ignores malformed JSON instead of throwing', async () => {
    const s = await load('{not json')
    expect(s.view).toBe('waterfall')
    expect(s.colw).toBe(232)
  })

  it('rejects out-of-range and unknown values field by field', async () => {
    const s = await load(
      JSON.stringify({
        view: 'diagonal',
        colw: 9999,
        inspHidden: 'yes',
        cbarOpen: 1,
        modelShade: 'ghost',
        modelHdr: 'volcano',
        modelHdrRotation: 999,
        modelHdrStrength: -1,
        modelHdrOpacity: 'half',
        modelHdrBlur: 2
      })
    )
    expect(s.view).toBe('waterfall')
    expect(s.colw).toBe(320)
    expect(s.inspHidden).toBe(false)
    expect(s.cbarOpen).toBe(false)
    expect(s.modelShade).toBe('solid')
    expect(s.modelHdr).toBe('forest')
    expect(s.modelHdrRotation).toBe(0)
    expect(s.modelHdrStrength).toBe(1)
    expect(s.modelHdrOpacity).toBe(0)
    expect(s.modelHdrBlur).toBe(0.5)
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

describe('record parsing tolerance', () => {
  it('degrades a broken palette field to an empty array', async () => {
    const { parsePalette } = await import('../src/renderer/src/data/safe-parse')

    expect(parsePalette('[{oops')).toEqual([]) // 非法 JSON
    expect(parsePalette('')).toEqual([]) // 空字符串
    expect(parsePalette(null)).toEqual([]) // null
    expect(parsePalette('{"hex":"#ffffff"}')).toEqual([]) // 合法 JSON 但非数组
    expect(parsePalette('[{"hex":"#112233","ratio":40}]')).toEqual([{ hex: '#112233', ratio: 40 }])
  })

  it('keeps every record of a batch when one of them has a broken palette', async () => {
    vi.stubGlobal('window', { windowApi: {} })
    const { rowToAsset } = await import('../src/renderer/src/store/ui')
    const row = (id: number, palette: unknown): Record<string, unknown> => ({
      id,
      library_id: 7,
      rel_path: `a${id}.jpg`,
      fingerprint: 'fp',
      type: 'image',
      format: 'JPG',
      name: `a${id}`,
      size_bytes: 1,
      imported_at: '2026-09-05T00:00',
      rating: 0,
      favorite: 0,
      review_flag: 0,
      tags: [],
      palette
    })

    const batch = [row(1, '[]'), row(2, '[{broken'), row(3, '[{"hex":"#AABBCC","ratio":50}]')]
    const assets = batch.map(rowToAsset)

    // 一条坏记录不该让整批加载失败,也不该影响同批其它记录
    expect(assets).toHaveLength(3)
    expect(assets.map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
    expect(assets[0].palette).toEqual([])
    expect(assets[1].palette).toEqual([])
    expect(assets[2].palette).toEqual([{ hex: '#AABBCC', ratio: 50 }])
  })
})

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e?: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const ROW = (id: number, name: string): Record<string, unknown> => ({
  id,
  library_id: 7,
  rel_path: `${name}.jpg`,
  fingerprint: 'fp',
  type: 'image',
  format: 'JPG',
  name,
  size_bytes: 1,
  imported_at: '2026-09-05T00:00',
  rating: 0,
  favorite: 0,
  review_flag: 0,
  tags: [],
  palette: '[]'
})

describe('library load failure visibility', () => {
  it('reports the failure and does not keep the previous collection', async () => {
    const toasts: { text: string; kind: string }[] = []
    const list = vi.fn().mockRejectedValue(new Error('ipc down'))
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      windowApi: {
        assets: { list },
        folders: { list: vi.fn().mockResolvedValue({ paths: [] }) }
      }
    })
    vi.resetModules()
    const { useUI, rowToAsset } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 't1', name: 'lib', libraryId: 7 }],
      activeTabId: 't1',
      assets: [rowToAsset(ROW(1, 'stale'))],
      mode: 'library',
      showToast: (text: string, kind = 'ok') => {
        toasts.push({ text, kind })
      }
    })

    useUI.getState().reloadActiveLibrary()
    await vi.waitFor(() => expect(toasts).toHaveLength(1))

    expect(toasts[0].kind).toBe('warn')
    expect(list).toHaveBeenCalledWith(7)
    // 上次的集合没有被当成当前结果继续展示,界面进明确的失败态
    expect(useUI.getState().assets).toEqual([])
    expect(useUI.getState().mode).toBe('error')
  })

  it('drops a superseded request failure instead of clobbering the newer tab', async () => {
    const toasts: { text: string; kind: string }[] = []
    const old = deferred<{ assets: Record<string, unknown>[] }>()
    const fresh = deferred<{ assets: Record<string, unknown>[] }>()
    const list = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      windowApi: {
        assets: { list },
        folders: { list: vi.fn().mockResolvedValue({ paths: [] }) }
      }
    })
    vi.resetModules()
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 't1', name: 'lib', libraryId: 7 }],
      activeTabId: 't1',
      assets: [],
      mode: 'library',
      showToast: (text: string, kind = 'ok') => {
        toasts.push({ text, kind })
      }
    })

    useUI.getState().reloadActiveLibrary() // 旧请求
    useUI.getState().reloadActiveLibrary() // 新请求顶替它

    old.reject(new Error('boom'))
    await Promise.resolve()
    await Promise.resolve()

    // 旧请求的失败既不改界面也不提示 —— 它已经不属于当前界面了
    expect(toasts).toEqual([])
    expect(useUI.getState().mode).toBe('library')

    fresh.resolve({ assets: [ROW(2, 'fresh')] })
    await vi.waitFor(() => expect(useUI.getState().assets).toHaveLength(1))
    expect(useUI.getState().assets[0].name).toBe('fresh')
    expect(useUI.getState().mode).toBe('library')
  })
})

describe('destructive operations ask first', () => {
  const TRASHED = { ...ROW(1, 'gone'), deleted_at: '2026-10-01T00:00:00.000Z' }

  const load = async (
    answer: boolean,
    calls: { emptyTrash: ReturnType<typeof vi.fn>; purge: ReturnType<typeof vi.fn> }
  ): Promise<{
    useUI: typeof import('../src/renderer/src/store/ui').useUI
    confirm: ReturnType<typeof vi.fn>
    toasts: { text: string; kind: string }[]
  }> => {
    const confirm = vi.fn().mockReturnValue(answer)
    const toasts: { text: string; kind: string }[] = []
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      confirm,
      windowApi: {
        assets: {
          emptyTrash: calls.emptyTrash,
          purge: calls.purge,
          list: vi.fn().mockResolvedValue({ assets: [] })
        },
        folders: { list: vi.fn().mockResolvedValue({ paths: [] }) }
      }
    })
    vi.resetModules()
    const mod = await import('../src/renderer/src/store/ui')
    mod.useUI.setState({
      tabs: [{ id: 't1', name: 'lib', libraryId: 7 }],
      activeTabId: 't1',
      assets: [mod.rowToAsset(TRASHED)],
      mode: 'library',
      showToast: (text: string, kind = 'ok') => {
        toasts.push({ text, kind })
      }
    })
    return { useUI: mod.useUI, confirm, toasts }
  }

  it('sends nothing when the confirmation is dismissed', async () => {
    const calls = { emptyTrash: vi.fn().mockResolvedValue({ ok: true }), purge: vi.fn().mockResolvedValue({ ok: true, purged: 1 }) }
    const { useUI } = await load(false, calls)

    useUI.getState().purgeAsset('a1')
    useUI.getState().emptyTrash()
    await Promise.resolve()

    expect(calls.purge).not.toHaveBeenCalled()
    expect(calls.emptyTrash).not.toHaveBeenCalled()
  })

  it('sends one request after confirmation, with the consequence spelled out', async () => {
    const calls = { emptyTrash: vi.fn().mockResolvedValue({ ok: true }), purge: vi.fn().mockResolvedValue({ ok: true, purged: 1 }) }
    const { useUI, confirm } = await load(true, calls)

    useUI.getState().purgeAsset('a1')
    await vi.waitFor(() => expect(calls.purge).toHaveBeenCalledTimes(1))
    expect(calls.purge).toHaveBeenCalledWith(7, [1])

    const purgeText = String(confirm.mock.calls[0][0])
    expect(purgeText).toContain('1 条')
    expect(purgeText).toContain('不删除磁盘原文件')

    useUI.getState().emptyTrash()
    await vi.waitFor(() => expect(calls.emptyTrash).toHaveBeenCalledTimes(1))
    expect(calls.emptyTrash).toHaveBeenCalledWith(7)

    const emptyText = String(confirm.mock.calls[1][0])
    expect(emptyText).toContain('1 条')
    expect(emptyText).toContain('不删除磁盘原文件')
  })

  it('reports a failed purge and re-reads the library', async () => {
    const calls = { emptyTrash: vi.fn().mockResolvedValue({ ok: true }), purge: vi.fn().mockResolvedValue({ ok: false, purged: 0 }) }
    const { useUI, toasts } = await load(true, calls)

    useUI.getState().purgeAsset('a1')
    // 失败后要报出原因并回读,界面不能停在「本地已经删掉」的假象上
    await vi.waitFor(() => expect(toasts).toHaveLength(1))
    expect(calls.purge).toHaveBeenCalledTimes(1)
    expect(toasts[0].kind).toBe('warn')
    expect(toasts[0].text).toContain('失败')
  })
})

describe('selection membership index', () => {
  const asset = (id: string): {
    id: string
    type: string
    format: string
    name: string
    sizeBytes: number
    importedAt: string
    rating: number
    favorite: boolean
    tags: string[]
    folders: string[]
    note: string
    palette: never[]
  } => ({
    id,
    type: 'image',
    format: 'JPG',
    name: id,
    sizeBytes: 1,
    importedAt: '2026-09-05T00:00',
    rating: 0,
    favorite: false,
    tags: [],
    folders: [],
    note: '',
    palette: []
  })

  const load = async (ids: string[]): Promise<typeof import('../src/renderer/src/store/ui').useUI> => {
    vi.stubGlobal('window', { windowApi: {} })
    vi.resetModules()
    const mod = await import('../src/renderer/src/store/ui')
    mod.useUI.setState({ nav: 'all', assets: ids.map(asset) })
    return mod.useUI
  }

  it('keeps the membership set in step with the ordered selection', async () => {
    const useUI = await load(['a', 'b', 'c'])

    useUI.getState().setSelectedIds(['a', 'b'])
    expect(useUI.getState().selectedSet.has('a')).toBe(true)
    expect(useUI.getState().selectedSet.has('c')).toBe(false)

    // 替换式更新后旧成员必须立刻失效,否则卡片会停在「已选中」的样式上
    useUI.getState().selectOnly('c')
    expect(useUI.getState().selectedSet.has('a')).toBe(false)
    expect(useUI.getState().selectedSet.has('c')).toBe(true)

    useUI.getState().clearSelection()
    expect(useUI.getState().selectedSet.size).toBe(0)
  })

  it('tracks every click path, including shift ranges, ctrl toggles and trashing', async () => {
    const useUI = await load(['a', 'b', 'c'])
    const order = ['a', 'b', 'c']

    useUI.getState().clickCard('a', { order })
    useUI.getState().clickCard('c', { order, shift: true })
    expect([...useUI.getState().selectedSet].sort()).toEqual(['a', 'b', 'c'])

    useUI.getState().clickCard('b', { order, toggle: true })
    expect(useUI.getState().selectedSet.has('b')).toBe(false)

    useUI.getState().selectAllVisible()
    expect(useUI.getState().selectedSet.size).toBe(3)

    useUI.getState().trashAsset('a')
    expect(useUI.getState().selectedSet.has('a')).toBe(false)
    expect(useUI.getState().selectedSet.size).toBe(2)
    expect(useUI.getState().selectedIds).not.toContain('a')
  })

  it('holds 2000 ids so membership stays a lookup rather than a scan', async () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `a${i}`)
    const useUI = await load(ids)

    useUI.getState().selectAllVisible()

    expect(useUI.getState().selectedIds).toHaveLength(2000)
    expect(useUI.getState().selectedSet.size).toBe(2000)
    expect(useUI.getState().selectedSet.has('a1999')).toBe(true)
    expect(useUI.getState().selectedSet.has('absent')).toBe(false)
  })
})

describe('lightbox filtered navigation', () => {
  it('keeps fullscreen when the filmstrip switches to another asset', async () => {
    vi.stubGlobal('window', { windowApi: {}, confirm: () => true })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({ lightboxId: 'a1', lightboxFullscreen: true })

    useUI.getState().openLightbox('a2')

    expect(useUI.getState().lightboxFullscreen).toBe(true)
  })

  it('opens a lightbox in normal layout from the grid', async () => {
    vi.stubGlobal('window', { windowApi: {}, confirm: () => true })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({ lightboxId: null, lightboxFullscreen: false })

    useUI.getState().openLightbox('a1')

    expect(useUI.getState().lightboxFullscreen).toBe(false)
  })

  it('stays inside the current favorites view when stepping next', async () => {
    vi.stubGlobal('window', { windowApi: {}, confirm: () => true })
    const { useUI, rowToAsset } = await import('../src/renderer/src/store/ui')
    const row = (id: number, name: string, favorite: number) => ({
      id,
      library_id: 7,
      rel_path: `${name}.jpg`,
      fingerprint: '0123456789abcdef0123',
      type: 'image',
      format: 'JPG',
      name,
      size_bytes: 1,
      imported_at: '2026-10-01T00:00',
      rating: 0,
      favorite,
      review_flag: 0,
      tags: [],
      palette: '[]'
    })
    const favA = rowToAsset(row(1, 'fav-a', 1))
    const normal = rowToAsset(row(2, 'normal', 0))
    const favB = rowToAsset(row(3, 'fav-b', 1))
    useUI.setState({
      assets: [favA, normal, favB],
      nav: 'fav',
      search: '',
      filters: DEFAULT_FILTERS,
      stripColor: null,
      lightboxId: favA.id,
      cssDirty: false
    })

    useUI.getState().stepLightbox(1)

    expect(useUI.getState().lightboxId).toBe(favB.id)
  })
})

describe('copy selected assets', () => {
  it('copies selected rows from the active library', async () => {
    const copy = vi.fn().mockResolvedValue({ copied: 1, mode: 'files', skipped: [], paths: [] })
    const toasts: string[] = []
    vi.stubGlobal('window', { setTimeout, clearTimeout, windowApi: { assets: { copy } } })
    const { useUI, rowToAsset } = await import('../src/renderer/src/store/ui')
    const row = rowToAsset({
      id: 1,
      library_id: 7,
      rel_path: 'a.jpg',
      fingerprint: '0123456789abcdef0123',
      type: 'image',
      format: 'JPG',
      name: 'a',
      size_bytes: 1,
      imported_at: '2026-10-01T00:00',
      rating: 0,
      favorite: 0,
      review_flag: 0,
      tags: [],
      palette: '[]'
    })
    useUI.setState({
      tabs: [{ id: 't1', name: 'lib', libraryId: 7 }],
      activeTabId: 't1',
      assets: [row],
      selectedIds: [row.id],
      selectedSet: new Set([row.id]),
      showToast: (text: string) => toasts.push(text)
    })

    expect(useUI.getState().copySelected()).toBe(true)
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(7, [1]))
    expect(toasts).toEqual(['已复制 1 个文件'])
  })

  it('does not intercept copy when nothing is selected', async () => {
    const copy = vi.fn()
    vi.stubGlobal('window', { windowApi: { assets: { copy } } })
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 't1', name: 'lib', libraryId: 7 }],
      activeTabId: 't1',
      assets: [],
      selectedIds: [],
      selectedSet: new Set()
    })

    expect(useUI.getState().copySelected()).toBe(false)
    expect(copy).not.toHaveBeenCalled()
  })

  it('reports a rejected copy request', async () => {
    const copy = vi.fn().mockRejectedValue(new Error('ipc down'))
    const toasts: string[] = []
    vi.stubGlobal('window', { windowApi: { assets: { copy } } })
    const { useUI, rowToAsset } = await import('../src/renderer/src/store/ui')
    const row = rowToAsset({
      id: 1, library_id: 7, rel_path: 'a.jpg', fingerprint: '0123456789abcdef0123',
      type: 'image', format: 'JPG', name: 'a', size_bytes: 1, imported_at: '2026-10-01T00:00',
      rating: 0, favorite: 0, review_flag: 0, tags: [], palette: '[]'
    })
    useUI.setState({
      tabs: [{ id: 't1', name: 'lib', libraryId: 7 }],
      activeTabId: 't1',
      assets: [row],
      selectedIds: [row.id],
      selectedSet: new Set([row.id]),
      showToast: (text: string) => toasts.push(text)
    })

    useUI.getState().copySelected()
    await vi.waitFor(() => expect(toasts).toEqual(['复制失败,请重试']))
  })
})

describe('persistence failure feedback', () => {
  const row = (id: number): Record<string, unknown> => ({
    id,
    library_id: 7,
    rel_path: `a${id}.jpg`,
    fingerprint: '0123456789abcdef0123',
    type: 'image',
    format: 'JPG',
    name: `a${id}`,
    size_bytes: 1,
    imported_at: '2026-10-01T00:00',
    rating: 0,
    favorite: 0,
    review_flag: 0,
    tags: [],
    palette: '[]'
  })

  it('reports a rejected move and reloads the library', async () => {
    const move = vi.fn().mockRejectedValue(new Error('ipc down'))
    const reload = vi.fn()
    const toasts: string[] = []
    vi.stubGlobal('window', { setTimeout, clearTimeout, windowApi: { assets: { move } } })
    const { useUI, rowToAsset } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 't1', name: 'lib', libraryId: 7 }],
      activeTabId: 't1',
      assets: [rowToAsset(row(1))],
      reloadActiveLibrary: reload,
      showToast: (text: string) => toasts.push(text)
    })

    useUI.getState().moveAssetsToFolder(['a1'], 'target')
    await vi.waitFor(() => expect(toasts).toEqual(['移动素材失败,请重试']))
    expect(reload).toHaveBeenCalled()
  })

  it('reports a rejected tag write and reloads the library', async () => {
    const update = vi.fn().mockResolvedValue({ ok: true })
    const addTag = vi.fn().mockRejectedValue(new Error('ipc down'))
    const reload = vi.fn()
    const toasts: string[] = []
    vi.stubGlobal('window', { setTimeout, clearTimeout, windowApi: { assets: { update, addTag } } })
    const { useUI, rowToAsset } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 't1', name: 'lib', libraryId: 7 }],
      activeTabId: 't1',
      assets: [rowToAsset(row(1))],
      reloadActiveLibrary: reload,
      showToast: (text: string) => toasts.push(text)
    })

    useUI.getState().addTag('a1', 'new-tag')
    await vi.waitFor(() => expect(toasts).toEqual(['添加标签失败,请重试']))
    expect(reload).toHaveBeenCalled()
  })
})
