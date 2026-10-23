import { create } from 'zustand'
import type { Asset, LibraryTab, NavKey } from '../data/types'
import { TAGS } from '../data/dataset'
import { DEFAULT_FILTERS, queryAssets, queryLightboxAssets, type Filters } from '../data/query'
import { optimisticFolderMove, rebaseFolderPath } from '../data/folder-drag'
import { parsePalette } from '../data/safe-parse'
import { DEFAULT_HDR, parseHdrPreset, type HdrId } from '../data/hdr-presets'
import type { ModelShade } from '../components/Viewer3D'

export type ViewMode = 'waterfall' | 'grid' | 'list'

export interface CtxMenuState {
  x: number
  y: number
  assetId: string
}


export const mmss = (sec: number): string => {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
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
  /** 三维预览模式与 HDR 环境:跨重启保留 */
  modelShade: ModelShade
  modelHdr: HdrId
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
      collapsedFolders: [...s.collapsedFolders],
      modelShade: s.modelShade,
      modelHdr: s.modelHdr
    }
    void window.windowApi.state.set(UI_PREFS_KEY, JSON.stringify(prefs)).catch(() => {})
  } catch { /* ignore */ }
}

/** S2-9:setColw 高频调用,落库走防抖 */
let colwPersistTimer: ReturnType<typeof setTimeout> | null = null

/** 单键读取:异常或缺失都收敛成 null(等价于"没存过",沿用原有回退语义) */
type StateRead = { value: string | null; failed: boolean }

/** 读取 IPC 状态键:缺失与读失败分别处理,避免失败时覆盖有效首帧镜像 */
async function readState(key: string): Promise<StateRead> {
  try {
    return { value: await window.windowApi.state.get(key), failed: false }
  } catch {
    return { value: null, failed: true }
  }
}

/**
 * 读取并应用上次的界面偏好;逐项校验,损坏的字段退回默认值。
 *
 * 界面偏好(uiPrefs)与主题/音视频偏好(preferences)分两段独立解析:任一段缺失或
 * 损坏都不影响另一段。旧实现里 uiPrefs 为空会整段 return,连主题一起跳过。
 */
export async function restoreUiPrefs(): Promise<void> {
  const [uiRead, prefsRead] = await Promise.all([readState(UI_PREFS_KEY), readState('preferences')])
  const uiRaw = uiRead.value
  const prefsRaw = prefsRead.value

  // preferences 是权威记录:无论镜像写了什么,启动都以它校正外观并把镜像修回来。
  // 老用户(库里存着夜间、镜像还没写过)升级后第一次启动可能先显示浅色,校正后不再闪。
  if (!prefsRead.failed) {
    try {
      const { applyTheme, parseTheme, writeMirroredTheme } = await import('../data/theme')
      const theme = parseTheme(prefsRaw)
      applyTheme(theme)
      writeMirroredTheme(theme)
    } catch {
      /* 主题应用失败:保留首帧镜像给出的外观。 */
    }
  }

  if (!uiRead.failed && uiRaw) {
    try {
      const parsed = JSON.parse(uiRaw) as Partial<UiPrefs>
      const view: ViewMode =
        parsed.view === 'grid' || parsed.view === 'list' || parsed.view === 'waterfall' ? parsed.view : 'waterfall'
      const colw = Number(parsed.colw)
      useUI.setState({
        view,
        colw: Number.isFinite(colw) ? Math.min(320, Math.max(170, Math.round(colw))) : 232,
        inspHidden: parsed.inspHidden === true,
        cbarOpen: parsed.cbarOpen === true,
        nav: parseNav(parsed.nav),
        collapsedFolders: parseCollapsedFolders(parsed.collapsedFolders),
        modelShade: parsed.modelShade === 'render' ? 'render' : 'solid',
        modelHdr: parseHdrPreset(parsed.modelHdr)
      })
    } catch {
      /* 界面偏好损坏:保持默认 */
    }
  }

  if (!prefsRead.failed) {
    try {
      const parsed = JSON.parse(prefsRaw ?? '{}') as { hoverVideo?: unknown; hoverSound?: unknown }
      useUI.setState({ hoverVideo: parsed.hoverVideo !== false, hoverSound: parsed.hoverSound === true })
    } catch {
      /* 偏好损坏时保持默认。 */
    }
  }
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
    palette: parsePalette(r.palette),
    previewUrl: sourceUrl,
    originalUrl,
    absPath: r.absPath as string,
    deletedAt: (r.deleted_at as string) ?? undefined
  }
}

function TAG_COLOR(name: string): string {
  return TAGS[name] ?? '#64748B'
}

/**
 * 选中集在 store 里有两个表示，且必须在同一次 `set` 里一起更新：
 * - `selectedIds` 保序，供区间运算、右键菜单与批量操作使用；
 * - `selectedSet` 供卡片做 O(1) 成员判定 —— 卡片订阅的是「我在不在集合里」这一个布尔值，
 *   所以选中 2000 项时，滚动不会让每张卡对选中数组做一次线性扫描。
 */
function withSelection(ids: string[]): { selectedIds: string[]; selectedSet: ReadonlySet<string> } {
  return { selectedIds: ids, selectedSet: new Set(ids) }
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
  mode: 'empty' | 'library' | 'error'
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
  /** S1-7:assets:changed 携带 assetIds 时按 id 增量合并;缺省数组退全量 reload */
  applyAssetDelta: (libraryId: number, assetIds?: number[]) => void
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
  /** 三维预览:实体/渲染模式与 HDR 环境 */
  modelShade: ModelShade
  setModelShade: (mode: ModelShade) => void
  modelHdr: HdrId
  setModelHdr: (id: HdrId) => void

  /* 素材数据(可变字段走 store,编辑经 IPC 落库) */
  assets: Asset[]
  setRating: (id: string, v: number) => void
  toggleFavorite: (id: string) => void
  toggleReviewFlag: (id: string) => void
  /** 复制当前库的选中素材；返回是否发起了复制请求 */
  copySelected: () => boolean
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
  /** `selectedIds` 的成员索引，与它同一次 `set` 更新；卡片按它做 O(1) 命中判定 */
  selectedSet: ReadonlySet<string>
  selectionAnchorId: string | null
  activeId: string | null
  focusedCardId: string | null
  clickCard: (id: string, options?: { shift?: boolean; toggle?: boolean; order?: string[] }) => void
  /** 单选替换：右键与 Space 复用，不参与 Shift 区间的顺序表 */
  selectOnly: (id: string) => void
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
  /**
   * 灯箱全屏:仅在该窗口内铺满,不改系统窗口状态。
   * 与 lightboxId 一样属瞬时视图态,不持久化——重启后带着全屏打开会让人失去方位感。
   */
  lightboxFullscreen: boolean
  setLightboxFullscreen: (v: boolean) => void
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
      window.windowApi.assets.update(a.libraryId, a.dbId, patch).catch(() => get().showToast('保存失败:数据库写入错误,请重试', 'warn'))
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
        get().showToast(r.error, 'warn')
        return false
      }
      get().setLibraries([...libs, r])
      if (r.warning) get().showToast(r.warning, 'warn')
      get().openLibrary(r.id, r.name)
      return true
    },
    importEagleFlow: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      const libraryId = t?.libraryId
      if (libraryId == null) {
        get().showToast('请先打开一个资源库', 'warn')
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
            get().showToast(result.error, 'warn')
            return
          }
          get().reloadActiveLibrary()
        } catch (error) {
          set({ scanProgress: null })
          get().showToast(`导入 Eagle 素材失败: ${error instanceof Error ? error.message : '未知错误'}`, 'warn')
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
    applyAssetDelta: (libraryId, assetIds) => {
      // S1-7 增量合并:只对当前活动库生效;其他库的事件直接丢弃(该库激活时会全量重拉)
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId !== libraryId) return
      if (!Array.isArray(assetIds) || assetIds.length === 0) {
        get().reloadActiveLibrary()
        return
      }
      const request = ++reloadSeq
      void window.windowApi.assets.rows(libraryId, assetIds).then((r) => {
        if (request !== reloadSeq) return
        const incoming = r.assets as unknown as Record<string, unknown>[]
        if (!Array.isArray(incoming)) return
        set((s) => {
          const rows = incoming.map(rowToAsset)
          const byId = new Map(rows.map((a) => [a.dbId as number, a]))
          const idSet = new Set(byId.keys())
          const keep: Asset[] = []
          for (const a of s.assets) {
            if (a.dbId != null && idSet.has(a.dbId)) {
              keep.push(byId.get(a.dbId) as Asset)
            } else if (assetIds.includes(a.dbId as number)) {
              // 事件点名但查询缺席 = 行已硬删,原地剔除
            } else {
              keep.push(a)
            }
          }
          // 新素材插入表头(全量查询按 imported_at DESC, id DESC 排序;增量行都是刚写入的)
          const existing = new Set(keep.map((a) => a.dbId))
          for (const a of rows) {
            if (!existing.has(a.dbId as number)) {
              keep.unshift(a)
            }
          }
          // 新行可能带来新文件夹路径,并入文件夹树(不做重排——manual 顺序由全量 reload 恢复)
          const folderSet = new Set(s.physicalFolderPaths)
          for (const a of rows) for (const f of a.folders) folderSet.add(f)
          const physicalFolderPaths = [...folderSet].sort()
          return {
            assets: keep,
            folderPaths: physicalFolderPaths,
            physicalFolderPaths
          }
        })
      }).catch(() => {
        // 增量通道异常退全量,保证一致性优先于省流量
        get().reloadActiveLibrary()
      })
    },
    reloadActiveLibrary: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) {
        set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'empty' })
        return
      }
      const libraryId = t.libraryId
      const request = ++reloadSeq
      /* 已被更新的请求顶替、或用户已切到别的库:这次结果(成功或失败)都不再属于当前界面 */
      const superseded = (): boolean =>
        request !== reloadSeq || get().tabs.find((x) => x.id === get().activeTabId)?.libraryId !== libraryId
      void Promise.all([window.windowApi.assets.list(libraryId), window.windowApi.folders.list(libraryId)]).then(([r, folders]) => {
        if (superseded()) return
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
          return
        }
        /* 主进程回了结构不对的响应(例如 {error}):与请求失败同待遇,不把上次的集合当当前结果 */
        set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'error' })
        get().showToast('素材库加载失败，请重试', 'warn')
      }).catch(() => {
        /* 失败不留过期数据:清空并进失败态,界面与磁盘真实状态保持一致 */
        if (superseded()) return
        set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'error' })
        get().showToast('素材库加载失败，请重试', 'warn')
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
        /* 失败不改目录树:留下与磁盘不符的中间态比维持原样更危险 */
        if (!('paths' in r)) {
          get().showToast('目录列表刷新失败，目录树保持原样', 'warn')
          return
        }
        set((s) => {
          const activeFolder = s.nav.startsWith('folder:') ? s.nav.slice('folder:'.length) : null
          return {
            folderPaths: r.paths,
            physicalFolderPaths: r.paths,
            folderEditPath: s.folderEditPath && r.paths.includes(s.folderEditPath) ? s.folderEditPath : null,
            nav: activeFolder && !r.paths.includes(activeFolder) ? 'all' : s.nav
          }
        })
      }).catch(() => {
        get().showToast('目录列表刷新失败，目录树保持原样', 'warn')
      })
    },
    createFolder: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      void window.windowApi.folders.create(t.libraryId).then((r) => {
        if ('error' in r) {
          get().showToast(r.error, 'warn')
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
          get().showToast(r.error, 'warn')
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
          get().showToast('error' in r ? r.error : '移动文件夹失败,请重试', 'warn')
          get().reloadActiveLibrary()
          return
        }
        set((s) => ({ nav: rebaseFolderNav(s.nav, source, r.path) }))
        get().reloadActiveLibrary()
      }).catch(() => {
        get().showToast('移动文件夹失败,请重试', 'warn')
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
      if (ids.length < assetIds.length) get().showToast('部分素材不可处理,本次已跳过', 'warn')

      void window.windowApi.assets.move(t.libraryId, ids, folder).then((r) => {
        if ('error' in r) {
          if (r.moved) get().reloadActiveLibrary()
          get().showToast(r.error, 'warn')
          return
        }
        get().reloadActiveLibrary()
      }).catch(() => {
        get().showToast('移动素材失败,请重试', 'warn')
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
      // S2-9:Ctrl+滚轮每 tick 都到这,落库防抖 300ms(与主窗口 resize 防抖策略对齐),
      // 避免高频 IPC + SQLite 写;视口令牌由 App.tsx 立即更新,不等待防抖
      if (colwPersistTimer) clearTimeout(colwPersistTimer)
      colwPersistTimer = setTimeout(persistUiPrefs, 300)
    },
    inspHidden: false,
    toggleInspector: () => {
      set((s) => ({ inspHidden: !s.inspHidden }))
      persistUiPrefs()
    },
    modelShade: 'solid',
    setModelShade: (modelShade) => {
      set({ modelShade })
      persistUiPrefs()
    },
    modelHdr: DEFAULT_HDR,
    setModelHdr: (modelHdr) => {
      set({ modelHdr })
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
    copySelected: () => {
      const tab = get().tabs.find((item) => item.id === get().activeTabId)
      const libraryId = tab?.libraryId
      if (libraryId == null) return false
      const ids = get().assets
        .filter((asset) => get().selectedSet.has(asset.id) && asset.dbId != null && asset.libraryId === libraryId)
        .map((asset) => asset.dbId as number)
      if (ids.length === 0) return false
      void window.windowApi.assets.copy(libraryId, ids).then((result) => {
        if ('error' in result) {
          get().showToast(result.error, 'warn')
          return
        }
        const skipped = result.skipped.length
        if (result.mode === 'paths') {
          get().showToast(
            skipped > 0 ? `已复制 ${result.copied} 条路径,${skipped} 个文件已缺失` : `已复制 ${result.copied} 条路径`,
            skipped > 0 ? 'warn' : 'ok'
          )
          return
        }
        get().showToast(
          skipped > 0 ? `已复制 ${result.copied} 个文件,跳过 ${skipped} 个缺失项` : `已复制 ${result.copied} 个文件`,
          skipped > 0 ? 'warn' : 'ok'
        )
      }).catch(() => get().showToast('复制失败,请重试', 'warn'))
      return true
    },
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
          // 静默失败会让「重命名没反应」无从排查,这里必须报出来,并把内存回读成磁盘上的真实名字
          get().showToast(r.error, 'warn')
          void get().reloadActiveLibrary()
          return
        }
        get().showToast('已重命名')
        void get().reloadActiveLibrary()
      }).catch(() => {
        get().showToast('重命名失败，界面已回读磁盘上的真实名称', 'warn')
        void get().reloadActiveLibrary()
      })
    },
    addTag: (id, name) => {
      const a = get().assets.find((x) => x.id === id)
      if (!a || a.tags.some((t) => t.name === name)) return
      edit(id, {}, (x) => ({ ...x, tags: [...x.tags, { name, color: TAG_COLOR(name) }] }))
      if (a.dbId != null && a.libraryId != null) {
        void window.windowApi.assets.addTag(a.libraryId, a.dbId, name).then((result) => {
          if (result.ok) return
          get().showToast('添加标签失败,请重试', 'warn')
          get().reloadActiveLibrary()
        }).catch(() => {
          get().showToast('添加标签失败,请重试', 'warn')
          get().reloadActiveLibrary()
        })
      }
    },
    removeTag: (id, name) => {
      edit(id, {}, (x) => ({ ...x, tags: x.tags.filter((t) => t.name !== name) }))
      const a = get().assets.find((x) => x.id === id)
      if (a?.dbId != null && a.libraryId != null) {
        void window.windowApi.assets.removeTag(a.libraryId, a.dbId, name).then((result) => {
          if (result.ok) return
          get().showToast('删除标签失败,请重试', 'warn')
          get().reloadActiveLibrary()
        }).catch(() => {
          get().showToast('删除标签失败,请重试', 'warn')
          get().reloadActiveLibrary()
        })
      }
    },
    setNote: (id, note) => edit(id, { note }, (a) => ({ ...a, note })),
    setSourceUrl: (id, url) => edit(id, { source_url: url || null }, (a) => ({ ...a, sourceUrl: url || undefined })),
    trashAsset: (id) => {
      const now = new Date().toISOString()
      edit(id, { deleted_at: now }, (a) => ({ ...a, deletedAt: now, previewUrl: a.originalUrl }))
      set((s) => ({
        ...withSelection(s.selectedIds.filter((x) => x !== id)),
        activeId: s.activeId === id ? null : s.activeId,
        lightboxId: s.lightboxId === id ? null : s.lightboxId,
        ctxMenu: null
      }))
    },
    restoreAsset: (id) => edit(id, { deleted_at: null }, (a) => ({ ...a, deletedAt: undefined, previewUrl: a.originalUrl ? `${a.originalUrl}&thumb=1` : a.previewUrl })),
    emptyTrash: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      const count = get().assets.filter((a) => a.deletedAt).length
      /* 破坏性操作先确认:写清后果与不做的事;取消时一个请求都不发 */
      if (!window.confirm(`清空回收站会移除 ${count} 条素材的数据库记录与缩略图缓存,不删除磁盘原文件。确定继续吗?`)) return
      const done = (ok: boolean): void => {
        if (!ok) get().showToast('清空回收站失败，记录未被清除', 'warn')
        void get().reloadActiveLibrary()
      }
      void window.windowApi.assets.emptyTrash(t.libraryId)
        .then((r) => done(r?.ok === true))
        .catch(() => done(false))
    },
    purgeAsset: (id) => {
      const a = get().assets.find((x) => x.id === id)
      if (a?.dbId == null || a.libraryId == null) return
      if (!window.confirm(`彻底删除「${a.name}」会移除 1 条素材的数据库记录与缩略图缓存,不删除磁盘原文件。确定继续吗?`)) return
      const done = (ok: boolean): void => {
        if (!ok) get().showToast('彻底删除失败，记录未被清除', 'warn')
        void get().reloadActiveLibrary()
      }
      void window.windowApi.assets.purge(a.libraryId, [a.dbId])
        .then((r) => done(r?.ok === true))
        .catch(() => done(false))
    },

    selectedIds: [],
    selectedSet: new Set<string>(),
    selectionAnchorId: null,
    activeId: null,
    focusedCardId: null,
    /**
     * 单击的选中语义(桌面惯例)：
     * - 无修饰键：替换为单选，检查器与键盘焦点同步切到该卡
     * - Shift：从锚点重算区间并替换选区（锚点不动，便于继续 Shift 缩选区）
     * - Ctrl/Cmd：对单项 toggle，其它卡片保持不变
     */
    clickCard: (id, options) =>
      set((s) => {
        const order = options?.order ?? s.assets.map((a) => a.id)
        if (options?.shift) {
          const anchor = s.selectionAnchorId ?? id
          const start = order.indexOf(anchor)
          const end = order.indexOf(id)
          const range =
            start >= 0 && end >= 0
              ? order.slice(Math.min(start, end), Math.max(start, end) + 1)
              : [id]
          return { ...withSelection(range), selectionAnchorId: anchor, activeId: id, focusedCardId: id }
        }
        if (options?.toggle) {
          const selectedIds = s.selectedIds.includes(id)
            ? s.selectedIds.filter((x) => x !== id)
            : [...s.selectedIds, id]
          return { ...withSelection(selectedIds), selectionAnchorId: id, activeId: id, focusedCardId: id }
        }
        return { ...withSelection([id]), selectionAnchorId: id, activeId: id, focusedCardId: id }
      }),
    /** 单选替换（右键 / Space）：不建全量顺序表也不参与区间算法 */
    selectOnly: (id) =>
      set({ ...withSelection([id]), selectionAnchorId: id, activeId: id, focusedCardId: id }),
    selectAllVisible: () =>
      set((s) => {
        const visible = queryAssets(s.assets, {
          nav: s.nav,
          search: s.search,
          filters: s.filters,
          stripColor: s.stripColor
        })
        const selectedIds = visible.map((a) => a.id)
        const lastId = selectedIds[selectedIds.length - 1] ?? null
        return { ...withSelection(selectedIds), selectionAnchorId: lastId, activeId: lastId, focusedCardId: lastId }
      }),
    setSelectedIds: (ids) =>
      set({ ...withSelection(ids), selectionAnchorId: ids[ids.length - 1] ?? null }),
    setFocusedCard: (focusedCardId) => set({ focusedCardId }),
    clearSelection: () => set({ ...withSelection([]), selectionAnchorId: null }),

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
    lightboxFullscreen: false,
    setLightboxFullscreen: (v) => set({ lightboxFullscreen: v }),
    cssDirty: false,
    setCssDirty: (v) => set({ cssDirty: v }),
    openLightbox: (id) =>
      // 同步 activeId:右侧已有的检查器渲染的就是它,这样灯箱里看的那张与检查器显示的始终一致
      set((s) => ({
        lightboxId: id,
        activeId: id,
        focusedCardId: id,
        cssDirty: false,
        // 从胶片带换片时保留全屏;从网格首次打开时仍从普通布局开始。
        lightboxFullscreen: s.lightboxId ? s.lightboxFullscreen : false,
        openMenu: null,
        ctxMenu: null
      })),
    closeLightbox: () => {
      // Esc / 关闭按钮 / 遮罩点击都经此处:未保存的 CSS 改动必须先确认
      if (get().cssDirty && !window.confirm('CSS 有未保存的修改,关闭将丢弃这些改动。')) return
      set({ lightboxId: null, cssDirty: false, lightboxFullscreen: false })
    },
    stepLightbox: (dir) => {
      const { lightboxId, assets, nav, search, filters, stripColor } = get()
      if (get().cssDirty && !window.confirm('CSS 有未保存的修改,切换素材将丢弃这些改动。')) return
      const visible = queryLightboxAssets(assets, { nav, search, filters, stripColor }, lightboxId)
      if (visible.length === 0) return
      const idx = visible.findIndex((a) => a.id === lightboxId)
      if (idx < 0) return
      const next = Math.min(visible.length - 1, Math.max(0, idx + dir))
      // 跨素材保留全屏态:连续逐张看片时不必每张都重新按一次全屏;activeId 同步跟随检查器
      set({ lightboxId: visible[next].id, activeId: visible[next].id, focusedCardId: visible[next].id, cssDirty: false })
    }
  }
})

export { rowToAsset }
