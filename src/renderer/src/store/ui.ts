import { create } from 'zustand'
import type { Asset, LibraryTab, NavKey, PaletteColor } from '../data/types'
import { TAGS } from '../data/dataset'
import { DEFAULT_FILTERS, queryAssets, type Filters } from '../data/query'
import { optimisticFolderMove, rebaseFolderPath } from '../data/folder-drag'

export type ViewMode = 'waterfall' | 'grid' | 'list'

export interface CtxMenuState {
  x: number
  y: number
  assetId: string
}


const mmss = (sec: number): string => {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function rebaseFolderNav(nav: NavKey, source: string, target: string): NavKey {
  if (!nav.startsWith('folder:')) return nav
  const path = nav.slice('folder:'.length)
  if (path === source) return `folder:${target}`
  return path.startsWith(`${source}/`) ? `folder:${target}${path.slice(source.length)}` : nav
}

/* ---------- 界面偏好持久化(视图/列宽/信息面板/色带/导航) ---------- */

const UI_PREFS_KEY = 'uiPrefs'

interface UiPrefs {
  view: ViewMode
  colw: number
  inspHidden: boolean
  cbarOpen: boolean
  /** 上次停留的侧栏导航项(全部素材/文件夹/标签等) */
  nav: NavKey
  /** 已折叠的文件夹路径:该库文件夹树很深,折叠状态需跨重启保留 */
  collapsedFolders: string[]
}

const NAV_SIMPLE: readonly NavKey[] = ['all', 'recent', 'untagged', 'fav', 'trash']

/** 校验导航键格式;非法值退回 'all'(目标是否存在由 reloadActiveLibrary 另行校验) */
function parseNav(value: unknown): NavKey {
  if (typeof value !== 'string') return 'all'
  if ((NAV_SIMPLE as readonly string[]).includes(value)) return value as NavKey
  if (value.startsWith('folder:') && value.length > 'folder:'.length) return value as NavKey
  if (value.startsWith('tag:') && value.length > 'tag:'.length) return value as NavKey
  return 'all'
}

/** 校验折叠文件夹列表:只收非空字符串,坏值整体退回空(全部展开) */
function parseCollapsedFolders(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v !== '')
}

/** 把当前界面偏好写入主进程(失败静默:偏好丢失不应影响使用) */
function persistUiPrefs(): void {
  try {
    const s = useUI.getState()
    const prefs: UiPrefs = {
      view: s.view,
      colw: s.colw,
      inspHidden: s.inspHidden,
      cbarOpen: s.cbarOpen,
      nav: s.nav,
      collapsedFolders: [...s.collapsedFolders]
    }
    void window.windowApi.state.set(UI_PREFS_KEY, JSON.stringify(prefs)).catch(() => {})
  } catch { /* ignore */ }
}

/** 读取并应用上次的界面偏好;逐项校验,损坏的字段退回默认值 */
export async function restoreUiPrefs(): Promise<void> {
  try {
    const raw = await window.windowApi.state.get(UI_PREFS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    const view: ViewMode =
      parsed.view === 'grid' || parsed.view === 'list' || parsed.view === 'waterfall' ? parsed.view : 'waterfall'
    const colw = Number(parsed.colw)
    useUI.setState({
      view,
      colw: Number.isFinite(colw) ? Math.min(320, Math.max(170, Math.round(colw))) : 232,
      inspHidden: parsed.inspHidden === true,
      cbarOpen: parsed.cbarOpen === true,
      nav: parseNav(parsed.nav),
      collapsedFolders: parseCollapsedFolders(parsed.collapsedFolders)
    })
  } catch { /* 读取失败保持默认 */ }
  // 主题与音视频偏好存在 preferences 键(与设置页同一份记录),启动即应用
  try {
    const prefs = await window.windowApi.state.get('preferences')
    const { applyTheme, parseTheme } = await import('../data/theme')
    applyTheme(parseTheme(prefs))
    const parsed = JSON.parse(prefs ?? '{}') as { hoverVideo?: unknown; hoverSound?: unknown }
    useUI.setState({ hoverVideo: parsed.hoverVideo !== false, hoverSound: parsed.hoverSound === true })
  } catch { /* 偏好读取失败保持默认 */ }
}

/** 主进程资产行 → Asset */
function rowToAsset(r: Record<string, unknown>): Asset {
  const tags = (r.tags as { name: string; color: string }[]) ?? []
  const relPath = String(r.rel_path ?? '')
  const folderChain = (path: string): string[] => {
    const parts = path.split('/').filter(Boolean).slice(0, -1)
    return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
  }
  const folders = folderChain(relPath)
  const fingerprint = encodeURIComponent(String(r.fingerprint ?? ''))
  // 网格卡片走 640px 缩略图缓存(?thumb=1);回收站素材入库时已清理缩略图,不再请求它
  const originalUrl = `media://${r.library_id as number}/${encodeURIComponent(relPath)}?v=${fingerprint}`
  const sourceUrl = r.deleted_at ? originalUrl : `${originalUrl}&thumb=1`
  return {
    id: `a${r.id as number}`,
    dbId: r.id as number,
    libraryId: r.library_id as number,
    relPath,
    fingerprint: r.fingerprint as string,
    missing: (r.missing as number) === 1,
    type: r.type as Asset['type'],
    format: r.format as Asset['format'],
    name: r.name as string,
    width: (r.width as number) ?? undefined,
    height: (r.height as number) ?? undefined,
    faceCount: (r.face_count as number) ?? undefined,
    vertices: (r.vertices as number) ?? undefined,
    materialInfo: (r.material_info as string) ?? undefined,
    duration: r.duration != null ? mmss(r.duration as number) : undefined,
    codec: (r.codec as string) ?? undefined,
    fps: (r.fps as number) ?? undefined,
    sizeBytes: r.size_bytes as number,
    importedAt: (r.imported_at as string).replace(' ', 'T'),
    rating: (r.rating as 0 | 1 | 2 | 3 | 4 | 5) ?? 0,
    favorite: (r.favorite as number) === 1,
    reviewFlag: (r.review_flag as number) === 1,
    tags,
    /* 目录链:完整相对目录前缀(sub、sub/inner),树构建与导航共用 */
    folders,
    note: (r.note as string) ?? '',
    sourceUrl: (r.source_url as string) ?? undefined,
    palette: JSON.parse((r.palette as string) || '[]') as PaletteColor[],
    previewUrl: sourceUrl,
    originalUrl,
    absPath: r.absPath as string,
    deletedAt: (r.deleted_at as string) ?? undefined
  }
}

function TAG_COLOR(name: string): string {
  return TAGS[name] ?? '#64748B'
}

interface UIState {
  /* 已绑定库列表(「+」菜单与引导卡共用) */
  libraries: { id: number; name: string; path: string }[]
  setLibraries: (list: { id: number; name: string; path: string }[]) => void
  createLibraryFlow: (name?: string, folderPath?: string) => Promise<boolean>
  importEagleFlow: () => void
  openLibrary: (libraryId: number, name: string) => void

  /* 标题栏库标签页 */
  tabs: LibraryTab[]
  activeTabId: string
  openTab: (id: string) => void
  closeTab: (id: string) => void
  createLibraryTab: (libraryId: number, name: string) => void
  persistTabs: () => void

  /* 数据源 */
  mode: 'empty' | 'library'
  scanProgress: string | null
  /** 缩略图全量生成进度;null 表示没有正在进行的预热 */
  thumbProgress: { done: number; total: number } | null
  setThumbProgress: (p: { done: number; total: number } | null) => void
  /** 一次性操作提示(复制/重命名等);自动消失,null 表示无提示 */
  toast: { text: string; kind: 'ok' | 'warn' } | null
  showToast: (text: string, kind?: 'ok' | 'warn') => void
  /** 列表悬浮自动播放(设置 → 音视频);只读镜像,由 preferences 同步 */
  hoverVideo: boolean
  hoverSound: boolean
  setHoverPlayback: (video: boolean, sound: boolean) => void
  setAssets: (list: Asset[]) => void
  reloadActiveLibrary: () => void
  folderPaths: string[]
  physicalFolderPaths: string[]
  folderEditPath: string | null
  /** 已折叠的文件夹路径;跨重启保留,深树不必每次重新收起 */
  collapsedFolders: string[]
  toggleFolderCollapsed: (path: string) => void
  refreshFolders: () => void
  createFolder: () => void
  renameFolder: (path: string, name: string) => void
  cancelFolderRename: () => void
  moveFolder: (source: string, target: string, placement: 'before' | 'after' | 'inside') => void
  moveAssetsToFolder: (assetIds: string[], folder: string) => void

  /* 导航与搜索 */
  nav: NavKey
  setNav: (n: NavKey) => void
  search: string
  setSearch: (s: string) => void

  /* 筛选 */
  filters: Filters
  setFilter: (k: keyof Filters, v: string) => void
  swatches: string[]
  toggleSwatch: (color: string) => void
  clearSwatches: () => void
  stripColor: string | null
  setStripColor: (hex: string | null) => void
  cbarOpen: boolean
  toggleCbar: () => void

  /* 视图 */
  view: ViewMode
  setView: (v: ViewMode) => void
  colw: number
  setColw: (n: number) => void
  inspHidden: boolean
  toggleInspector: () => void

  /* 素材数据(可变字段走 store,编辑经 IPC 落库) */
  assets: Asset[]
  setRating: (id: string, v: number) => void
  toggleFavorite: (id: string) => void
  toggleReviewFlag: (id: string) => void
  renameAsset: (id: string, name: string) => void
  addTag: (id: string, name: string) => void
  removeTag: (id: string, name: string) => void
  setNote: (id: string, note: string) => void
  setSourceUrl: (id: string, url: string) => void
  trashAsset: (id: string) => void
  restoreAsset: (id: string) => void
  emptyTrash: () => void
  purgeAsset: (id: string) => void

  /* 选中与焦点 */
  selectedIds: string[]
  selectionAnchorId: string | null
  activeId: string | null
  focusedCardId: string | null
  clickCard: (id: string, options?: { shift?: boolean; order?: string[] }) => void
  selectAllVisible: () => void
  setSelectedIds: (ids: string[]) => void
  setFocusedCard: (id: string | null) => void
  clearSelection: () => void

  /* 检查器文件名编辑 */
  renaming: boolean
  setRenaming: (v: boolean) => void
  /** 从右键菜单开始重命名:同时把 activeId 对齐到目标素材 */
  startRenaming: (id: string) => void

  /* 菜单 */
  openMenu: string | null
  setOpenMenu: (id: string | null) => void
  ctxMenu: CtxMenuState | null
  setCtxMenu: (s: CtxMenuState | null) => void

  /* 灯箱 */
  lightboxId: string | null
  /** CSS 编辑器有未保存改动:关闭与切换素材前必须先确认,避免丢改动 */
  cssDirty: boolean
  setCssDirty: (v: boolean) => void
  openLightbox: (id: string) => void
  closeLightbox: () => void
  stepLightbox: (dir: 1 | -1) => void
}

let tabSeq = 0
let reloadSeq = 0

export const useUI = create<UIState>((set, get) => {
  /** 编辑动作:本地立即生效 + 库模式落库(失败提示) */
  const edit = (id: string, patch: Record<string, unknown>, local: (a: Asset) => Asset): void => {
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? local(a) : a)) }))
    const a = get().assets.find((x) => x.id === id)
    if (a?.dbId != null && a.libraryId != null) {
      window.windowApi.assets.update(a.libraryId, a.dbId, patch).catch(() => alert('保存失败:数据库写入错误,请重试'))
    }
  }

  return {
    libraries: [],
    setLibraries: (libraries) => set({ libraries }),
    createLibraryFlow: async (name, folderPath) => {
      const folder = folderPath ?? await window.windowApi.pickFolder()
      if (!folder) return false
      const libs = get().libraries
      const bound = libs.find((l) => l.path.toLowerCase() === folder.toLowerCase())
      if (bound) {
        get().openLibrary(bound.id, bound.name)
        return true
      }
      const r = await window.windowApi.library.create(folder, name)
      if ('error' in r) {
        alert(r.error)
        return false
      }
      get().setLibraries([...libs, r])
      if (r.warning) alert(r.warning)
      get().openLibrary(r.id, r.name)
      return true
    },
    importEagleFlow: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      const libraryId = t?.libraryId
      if (libraryId == null) {
        alert('请先打开一个资源库')
        return
      }
      get().setOpenMenu(null)
      void (async () => {
        try {
          const folder = await window.windowApi.pickFolder()
          if (!folder) return
          set({ scanProgress: '正在导入 Eagle 素材' })
          const result = await window.windowApi.library.importEagle(libraryId, folder)
          if ('error' in result) {
            set({ scanProgress: null })
            alert(result.error)
            return
          }
          get().reloadActiveLibrary()
        } catch (error) {
          set({ scanProgress: null })
          alert(`导入 Eagle 素材失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      })()
    },
    openLibrary: (libraryId, name) => {
      set({ scanProgress: null })
      const open = get().tabs.find((t) => t.libraryId === libraryId)
      if (open) {
        set({ activeTabId: open.id })
        void window.windowApi.library.open(libraryId)
        get().reloadActiveLibrary()
      } else {
        get().createLibraryTab(libraryId, name)
      }
    },

    tabs: [],
    activeTabId: '',
    openTab: (id) => {
      set({ activeTabId: id })
      get().persistTabs()
      const t = get().tabs.find((x) => x.id === id)
      if (t?.libraryId != null) {
        void window.windowApi.library.open(t.libraryId)
        get().reloadActiveLibrary()
      }
      else if (!t?.libraryId) set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'empty' })
    },
    closeTab: (id) => {
      const { tabs, activeTabId } = get()
      const idx = tabs.findIndex((t) => t.id === id)
      const rest = tabs.filter((t) => t.id !== id)
      if (rest.length === 0) return
      const nextActive = id === activeTabId ? (rest[Math.max(0, idx - 1)] ?? rest[0]).id : activeTabId
      set({ tabs: rest, activeTabId: nextActive })
      get().persistTabs()
      const t = get().tabs.find((x) => x.id === nextActive)
      if (t?.libraryId != null) {
        void window.windowApi.library.open(t.libraryId)
        get().reloadActiveLibrary()
      }
      else set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'empty' })
    },
    createLibraryTab: (libraryId, name) => {
      tabSeq++
      const tab: LibraryTab = { id: `dblib-${libraryId}-${tabSeq}`, name, libraryId }
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
      get().persistTabs()
      void window.windowApi.library.open(libraryId)
      get().reloadActiveLibrary()
    },
    persistTabs: () => {
      const ids = get().tabs.filter((t) => t.libraryId != null).map((t) => t.libraryId as number)
      void window.windowApi.tabs.save(ids)
      void window.windowApi.state.set('activeTabLibrary', String(get().tabs.find((t) => t.id === get().activeTabId)?.libraryId ?? ''))
    },

    mode: 'empty',
    scanProgress: null,
    thumbProgress: null,
    setThumbProgress: (p) => set({ thumbProgress: p }),
    toast: null,
    /** 一次性提示:定时清空,并让后一条覆盖前一条 */
    showToast: (text, kind = 'ok') => {
      set({ toast: { text, kind } })
      const current = get().toast
      window.setTimeout(() => {
        if (get().toast === current) set({ toast: null })
      }, 2600)
    },
    setAssets: (list) => set({ assets: list }),
    reloadActiveLibrary: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) {
        set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'empty' })
        return
      }
      const libraryId = t.libraryId
      const request = ++reloadSeq
      void Promise.all([window.windowApi.assets.list(libraryId), window.windowApi.folders.list(libraryId)]).then(([r, folders]) => {
        if (request !== reloadSeq || get().tabs.find((x) => x.id === get().activeTabId)?.libraryId !== libraryId) return
        const data = r as {
          library?: unknown
          assets?: Record<string, unknown>[]
        }
        const assets = data.assets
        if (Array.isArray(assets)) {
          set((s) => {
            const physicalFolderPaths = 'paths' in folders ? folders.paths : []
            const folderPaths = physicalFolderPaths
            const activeFolder = s.nav.startsWith('folder:') ? s.nav.slice('folder:'.length) : null
            return {
              assets: assets.map(rowToAsset),
              folderPaths,
              physicalFolderPaths,
              folderEditPath: s.folderEditPath && folderPaths.includes(s.folderEditPath) ? s.folderEditPath : null,
              nav: activeFolder && !folderPaths.includes(activeFolder) ? 'all' : s.nav,
              mode: 'library'
            }
          })
        }
      })
    },
    folderPaths: [],
    physicalFolderPaths: [],
    folderEditPath: null,
    collapsedFolders: [],
    toggleFolderCollapsed: (path) => {
      set((s) => ({
        collapsedFolders: s.collapsedFolders.includes(path)
          ? s.collapsedFolders.filter((p) => p !== path)
          : [...s.collapsedFolders, path]
      }))
      persistUiPrefs()
    },
    refreshFolders: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      void window.windowApi.folders.list(t.libraryId).then((r) => {
        if (!('paths' in r)) return
        set((s) => {
          const activeFolder = s.nav.startsWith('folder:') ? s.nav.slice('folder:'.length) : null
          return {
            folderPaths: r.paths,
            physicalFolderPaths: r.paths,
            folderEditPath: s.folderEditPath && r.paths.includes(s.folderEditPath) ? s.folderEditPath : null,
            nav: activeFolder && !r.paths.includes(activeFolder) ? 'all' : s.nav
          }
        })
      })
    },
    createFolder: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      void window.windowApi.folders.create(t.libraryId).then((r) => {
        if ('error' in r) {
          alert(r.error)
          return
        }
        set({ folderEditPath: r.path, nav: `folder:${r.path}` as NavKey })
        get().refreshFolders()
      })
    },
    renameFolder: (path, name) => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      set({ folderEditPath: null })
      if (t?.libraryId == null) return
      void window.windowApi.folders.rename(t.libraryId, path, name).then((r) => {
        if ('error' in r) {
          alert(r.error)
          get().refreshFolders()
          return
        }
        set({ nav: `folder:${r.path}` as NavKey })
        get().refreshFolders()
      })
    },
    cancelFolderRename: () => set({ folderEditPath: null }),
    moveFolder: (source, target, placement) => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      const optimistic = optimisticFolderMove(get().folderPaths, source, target, placement)
      set((s) => ({
        folderPaths: optimistic.paths,
        physicalFolderPaths: optimistic.paths,
        nav: rebaseFolderNav(s.nav, source, optimistic.path),
        folderEditPath: s.folderEditPath ? rebaseFolderPath(s.folderEditPath, source, optimistic.path) : s.folderEditPath,
        assets: s.assets.map((asset) => {
          if (asset.libraryId !== t.libraryId || !asset.relPath) return asset
          const relPath = rebaseFolderPath(asset.relPath, source, optimistic.path)
          if (relPath === asset.relPath) return asset
          const fingerprint = encodeURIComponent(String(asset.fingerprint ?? ''))
          const originalUrl = `media://${asset.libraryId}/${encodeURIComponent(relPath)}?v=${fingerprint}`
          const previewUrl = `${originalUrl}&thumb=1`
          return {
            ...asset,
            relPath,
            folders: asset.folders.map((folder) => rebaseFolderPath(folder, source, optimistic.path)),
            previewUrl,
            originalUrl
          }
        })
      }))
      void window.windowApi.folders.move(t.libraryId, source, target, placement).then((r) => {
        if (!('path' in r) || typeof r.path !== 'string') {
          alert('error' in r ? r.error : '移动文件夹失败,请重试')
          get().reloadActiveLibrary()
          return
        }
        set((s) => ({ nav: rebaseFolderNav(s.nav, source, r.path) }))
        get().reloadActiveLibrary()
      }).catch(() => {
        alert('移动文件夹失败,请重试')
        get().reloadActiveLibrary()
      })
    },
    moveAssetsToFolder: (assetIds, folder) => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      const requested = new Set(assetIds)
      const ids = get().assets
        .filter((a) => requested.has(a.id) && a.dbId != null && a.libraryId === t.libraryId && !a.missing && !a.deletedAt)
        .map((a) => a.dbId as number)
      if (ids.length === 0) return
      if (ids.length < assetIds.length) alert('部分素材不可处理,本次已跳过')

      void window.windowApi.assets.move(t.libraryId, ids, folder).then((r) => {
        if ('error' in r) {
          if (r.moved) get().reloadActiveLibrary()
          alert(r.error)
          return
        }
        get().reloadActiveLibrary()
      })
    },

    nav: 'all',
    setNav: (nav) => {
      set({ nav })
      persistUiPrefs()
    },
    search: '',
    setSearch: (search) => set({ search }),

    filters: DEFAULT_FILTERS,
    setFilter: (k, v) => set((s) => ({ filters: { ...s.filters, [k]: v } })),
    swatches: [],
    toggleSwatch: (color) =>
      set((s) => ({
        swatches: s.swatches.includes(color) ? s.swatches.filter((c) => c !== color) : [...s.swatches, color]
      })),
    clearSwatches: () => set({ swatches: [] }),
    stripColor: null,
    setStripColor: (stripColor) => set({ stripColor }),
    cbarOpen: false,
    toggleCbar: () => {
      set((s) => ({ cbarOpen: !s.cbarOpen, openMenu: null }))
      persistUiPrefs()
    },

    view: 'waterfall',
    hoverVideo: true,
    hoverSound: false,
    setHoverPlayback: (video, sound) => set({ hoverVideo: video, hoverSound: sound }),
    setView: (view) => {
      set({ view, openMenu: null })
      persistUiPrefs()
    },
    colw: 232,
    setColw: (colw) => {
      set({ colw })
      persistUiPrefs()
    },
    inspHidden: false,
    toggleInspector: () => {
      set((s) => ({ inspHidden: !s.inspHidden }))
      persistUiPrefs()
    },

    assets: [],
    setRating: (id, v) =>
      edit(id, { rating: Math.min(5, Math.max(0, v)) }, (a) => ({
        ...a,
        rating: Math.min(5, Math.max(0, v)) as Asset['rating']
      })),
    toggleFavorite: (id) =>
      edit(id, { favorite: get().assets.find((x) => x.id === id)?.favorite ? 0 : 1 }, (a) => ({
        ...a,
        favorite: !a.favorite
      })),
    toggleReviewFlag: (id) =>
      edit(id, { review_flag: get().assets.find((x) => x.id === id)?.reviewFlag ? 0 : 1 }, (a) => ({
        ...a,
        reviewFlag: !a.reviewFlag
      })),
    /**
     * 重命名素材:改磁盘文件名,库记录随 `assets:changed` 一起刷新。
     *
     * 磁盘是权威来源,所以不在这里先改内存里的 name —— 等主进程改名成功后重新加载,
     * 避免「界面已改名但磁盘没改」的假象。失败时保持原样,不改动内存。
     */
    renameAsset: (id, name) => {
      set({ renaming: false })
      const a = get().assets.find((x) => x.id === id)
      if (!a || a.dbId == null || a.libraryId == null) return
      void window.windowApi.assets.rename(a.libraryId, a.dbId, name).then((r) => {
        if ('error' in r) {
          // 静默失败会让「重命名没反应」无从排查,这里必须报出来
          get().showToast(r.error, 'warn')
          return
        }
        get().showToast('已重命名')
        void get().reloadActiveLibrary()
      })
    },
    addTag: (id, name) => {
      const a = get().assets.find((x) => x.id === id)
      if (!a || a.tags.some((t) => t.name === name)) return
      edit(id, {}, (x) => ({ ...x, tags: [...x.tags, { name, color: TAG_COLOR(name) }] }))
      if (a.dbId != null && a.libraryId != null) void window.windowApi.assets.addTag(a.libraryId, a.dbId, name)
    },
    removeTag: (id, name) => {
      edit(id, {}, (x) => ({ ...x, tags: x.tags.filter((t) => t.name !== name) }))
      const a = get().assets.find((x) => x.id === id)
      if (a?.dbId != null && a.libraryId != null) void window.windowApi.assets.removeTag(a.libraryId, a.dbId, name)
    },
    setNote: (id, note) => edit(id, { note }, (a) => ({ ...a, note })),
    setSourceUrl: (id, url) => edit(id, { source_url: url || null }, (a) => ({ ...a, sourceUrl: url || undefined })),
    trashAsset: (id) => {
      const now = new Date().toISOString()
      edit(id, { deleted_at: now }, (a) => ({ ...a, deletedAt: now, previewUrl: a.originalUrl }))
      set((s) => ({
        selectedIds: s.selectedIds.filter((x) => x !== id),
        activeId: s.activeId === id ? null : s.activeId,
        lightboxId: s.lightboxId === id ? null : s.lightboxId,
        ctxMenu: null
      }))
    },
    restoreAsset: (id) => edit(id, { deleted_at: null }, (a) => ({ ...a, deletedAt: undefined, previewUrl: a.originalUrl ? `${a.originalUrl}&thumb=1` : a.previewUrl })),
    emptyTrash: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      void window.windowApi.assets.emptyTrash(t.libraryId).then(() => get().reloadActiveLibrary())
    },
    purgeAsset: (id) => {
      const a = get().assets.find((x) => x.id === id)
      if (a?.dbId == null || a.libraryId == null) return
      void window.windowApi.assets.purge(a.libraryId, [a.dbId]).then(() => get().reloadActiveLibrary())
    },

    selectedIds: [],
    selectionAnchorId: null,
    activeId: null,
    focusedCardId: null,
    clickCard: (id, options) =>
      set((s) => {
        const selected = new Set(s.selectedIds)
        const order = options?.order ?? s.assets.map((a) => a.id)
        const anchor = options?.shift ? s.selectionAnchorId : id
        if (options?.shift && anchor) {
          const start = order.indexOf(anchor)
          const end = order.indexOf(id)
          if (start >= 0 && end >= 0) {
            const [from, to] = start < end ? [start, end] : [end, start]
            for (const rangeId of order.slice(from, to + 1)) selected.add(rangeId)
          } else {
            selected.add(id)
          }
        } else {
          if (selected.has(id)) selected.delete(id)
          else selected.add(id)
        }
        return { selectedIds: [...selected], selectionAnchorId: anchor, activeId: id, focusedCardId: id }
      }),
    selectAllVisible: () =>
      set((s) => {
        const visible = queryAssets(s.assets, {
          nav: s.nav,
          search: s.search,
          filters: s.filters,
          swatches: s.swatches,
          stripColor: s.stripColor
        })
        const selectedIds = visible.map((a) => a.id)
        const lastId = selectedIds[selectedIds.length - 1] ?? null
        return { selectedIds, selectionAnchorId: lastId, activeId: lastId, focusedCardId: lastId }
      }),
    setSelectedIds: (ids) => set({ selectedIds: ids, selectionAnchorId: ids[ids.length - 1] ?? null }),
    setFocusedCard: (focusedCardId) => set({ focusedCardId }),
    clearSelection: () => set({ selectedIds: [], selectionAnchorId: null }),

    renaming: false,
    setRenaming: (renaming) => set({ renaming }),
    /**
     * 从右键菜单开始重命名。
     *
     * 重命名输入框长在检查器里,而检查器渲染的是 activeId 指向的素材;只置 renaming
     * 会让输入框出现在上一次选中的素材上。这里一并把 activeId/focusedCardId 对齐到目标。
     */
    startRenaming: (id) => set({ activeId: id, focusedCardId: id, renaming: true }),

    openMenu: null,
    setOpenMenu: (openMenu) => set(openMenu ? { openMenu, cbarOpen: false } : { openMenu }),
    ctxMenu: null,
    setCtxMenu: (ctxMenu) => set({ ctxMenu }),

    lightboxId: null,
    cssDirty: false,
    setCssDirty: (v) => set({ cssDirty: v }),
    openLightbox: (id) => set({ lightboxId: id, cssDirty: false, openMenu: null, ctxMenu: null }),
    closeLightbox: () => {
      // Esc / 关闭按钮 / 遮罩点击都经此处:未保存的 CSS 改动必须先确认
      if (get().cssDirty && !window.confirm('CSS 有未保存的修改,关闭将丢弃这些改动。')) return
      set({ lightboxId: null, cssDirty: false })
    },
    stepLightbox: (dir) => {
      const { lightboxId, assets } = get()
      if (get().cssDirty && !window.confirm('CSS 有未保存的修改,切换素材将丢弃这些改动。')) return
      const visible = assets.filter((a) => !a.deletedAt)
      if (visible.length === 0) return
      const idx = visible.findIndex((a) => a.id === lightboxId)
      if (idx < 0) return
      const next = Math.min(visible.length - 1, Math.max(0, idx + dir))
      set({ lightboxId: visible[next].id, cssDirty: false })
    }
  }
})

export { rowToAsset }
