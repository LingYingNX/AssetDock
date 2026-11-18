import { create } from 'zustand'
import type { Asset, LibraryTab, NavKey } from '../data/types'
import { TAGS } from '../data/dataset'
import { DEFAULT_FILTERS, queryAssets, queryLightboxAssets, type Filters } from '../data/query'
import { optimisticFolderMove, rebaseFolderPath } from '../data/folder-drag'
import { parsePalette } from '../data/safe-parse'
import {
  DEFAULT_HDR,
  DEFAULT_HDR_SETTINGS,
  parseHdrPreset,
  parseHdrSettings,
  type HdrId
} from '../data/hdr-presets'
import type { ModelShade } from '../components/Viewer3D'
import { DOCUMENT_RENDERER_VERSION, THUMB_CACHE_VERSION } from '../../../shared/thumbnailConfig'
import { SIDEBAR_DEFAULT, clampSidebarWidth } from '../data/sidebar-width'
import { COLW_DEFAULT, clampColw } from '../data/colw'
import { parseTagGroups, type TagGroupDefinition } from '../data/filter-menu'

export type ViewMode = 'waterfall' | 'grid' | 'list'

export interface CtxMenuState {
  x: number
  y: number
  assetId: string
}

export interface FolderCtxMenuState {
  x: number
  y: number
  path: string
  libraryId: number
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
  /** 上次停留的侧栏导航项(全部素材/文件夹等) */
  nav: NavKey
  /** 用户拖拽后的侧栏宽度 */
  sideWidth: number
  /** 已折叠的文件夹路径:该库文件夹树很深,折叠状态需跨重启保留。跨库共享,切库时不能按当前库的路径清空 */
  collapsedFolders: string[]
  /** 格式下拉里已折叠的分类(图片/视频/三维/代码/文档);跨重启保留 */
  collapsedFormatGroups: string[]
  /** 三维预览模式与 HDR 环境:跨重启保留 */
  modelShade: ModelShade
  modelHdr: HdrId
  modelHdrRotation: number
  modelHdrStrength: number
  modelHdrOpacity: number
  modelHdrBlur: number
  /** 每个库的标签总分类;键为库 id,随 uiPrefs 持久化 */
  tagGroups: Record<string, TagGroupDefinition[]>
  /** 灯箱底部胶片带是否展开:收起后仍留一条可点开的窄条 */
  stripOpen: boolean
}

const NAV_SIMPLE: readonly NavKey[] = ['all', 'recent', 'untagged', 'fav', 'trash']

/** 校验导航键格式;非法值退回 'all'(目标是否存在由 reloadActiveLibrary 另行校验) */
function parseNav(value: unknown): NavKey {
  if (typeof value !== 'string') return 'all'
  if ((NAV_SIMPLE as readonly string[]).includes(value)) return value as NavKey
  if (value.startsWith('folder:') && value.length > 'folder:'.length) return value as NavKey
  /* 标签导航已无界面入口(侧栏标签组删除),旧版本留下的 tag: 值一律退回「全部素材」,
     否则重启后会进入一个没有任何界面指示的标签过滤视图 */
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
      sideWidth: s.sideWidth,
      collapsedFolders: [...s.collapsedFolders],
      collapsedFormatGroups: [...s.collapsedFormatGroups],
      modelShade: s.modelShade,
      modelHdr: s.modelHdr,
      modelHdrRotation: s.modelHdrRotation,
      modelHdrStrength: s.modelHdrStrength,
      modelHdrOpacity: s.modelHdrOpacity,
      modelHdrBlur: s.modelHdrBlur,
      tagGroups: s.tagGroups,
      stripOpen: s.stripOpen
    }
    void window.windowApi.state.set(UI_PREFS_KEY, JSON.stringify(prefs)).catch(() => {})
  } catch { /* ignore */ }
}

/** S2-9:setColw 高频调用,落库走防抖 */
let colwPersistTimer: ReturnType<typeof setTimeout> | null = null
let sideWidthPersistTimer: ReturnType<typeof setTimeout> | null = null
let hdrPersistTimer: ReturnType<typeof setTimeout> | null = null

function scheduleHdrPersist(): void {
  if (hdrPersistTimer) clearTimeout(hdrPersistTimer)
  hdrPersistTimer = setTimeout(persistUiPrefs, 120)
}

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
      const hdr = parseHdrSettings(parsed as Record<string, unknown>)
      useUI.setState({
        view,
        colw: clampColw(colw),
        inspHidden: parsed.inspHidden === true,
        cbarOpen: parsed.cbarOpen === true,
        nav: parseNav(parsed.nav),
        sideWidth: parsed.sideWidth == null ? SIDEBAR_DEFAULT : clampSidebarWidth(Number(parsed.sideWidth)),
        collapsedFolders: parseCollapsedFolders(parsed.collapsedFolders),
        collapsedFormatGroups: parseCollapsedFolders(parsed.collapsedFormatGroups),
        modelShade: parsed.modelShade === 'render' ? 'render' : 'solid',
        modelHdr: parseHdrPreset(parsed.modelHdr),
        modelHdrRotation: hdr.rotation,
        modelHdrStrength: hdr.strength,
        modelHdrOpacity: hdr.opacity,
        modelHdrBlur: hdr.blur,
        tagGroups: parseTagGroups(parsed.tagGroups),
        stripOpen: parsed.stripOpen !== false
      })
    } catch {
      /* 界面偏好损坏:保持默认 */
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
  const sourceUrl = r.deleted_at ? originalUrl : thumbUrl(originalUrl)
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
    pageCount: (r.page_count as number) ?? undefined,
    sheetCount: (r.sheet_count as number) ?? undefined,
    slideCount: (r.slide_count as number) ?? undefined,
    textEncoding: (r.text_encoding as string) ?? undefined,
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

function thumbUrl(originalUrl: string): string {
  /*
    缓存键必须跟着「渲染规则」一起变。文档缩略图的外观由 DOCUMENT_RENDERER_VERSION 决定,
    只带 THUMB_CACHE_VERSION 时改了取景方式 URL 仍然相同,Chromium 会一直回旧图——
    表现就是「改了没效果」。两个版本都进键,任一升级即换 URL。
  */
  return `${originalUrl}&thumb=1&tv=${THUMB_CACHE_VERSION}-${DOCUMENT_RENDERER_VERSION}`
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
  /** 外部文件拖入:复制进目标文件夹、提示结果并刷新当前库 */
  importDroppedPaths: (paths: string[], folder: string) => Promise<void>
  importAssetFilesFlow: () => void
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
  /** 缩略图全量生成进度;libraryId 用于只显示当前素材库的进度 */
  thumbProgress: { libraryId: number; done: number; total: number } | null
  setThumbProgress: (p: { libraryId: number; done: number; total: number } | null) => void
  /** 跨库移动进度(源库归属);用户主动发起,所以不看当前标签页,操作结束由发起方清空 */
  transferProgress: { libraryId: number; done: number; total: number } | null
  setTransferProgress: (p: { libraryId: number; done: number; total: number } | null) => void
  /** 指纹 → 完成序号：懒生成占位必须先有这一跳，浏览器才会换 URL 重取真实图。 */
  thumbRevisions: Record<string, number>
  markThumbReady: (fingerprint: string) => void
  /** 一次性操作提示(复制/重命名等);自动消失,null 表示无提示 */
  toast: { text: string; kind: 'ok' | 'warn' } | null
  showToast: (text: string, kind?: 'ok' | 'warn') => void
  setAssets: (list: Asset[]) => void
  /** S1-7:assets:changed 携带 assetIds 时按 id 增量合并;缺省数组退全量 reload */
  applyAssetDelta: (libraryId: number, assetIds?: number[]) => void
  reloadActiveLibrary: (reuseCache?: boolean) => void
  folderPaths: string[]
  physicalFolderPaths: string[]
  folderEditPath: string | null
  /** 已折叠的文件夹路径;跨重启保留,深树不必每次重新收起 */
  collapsedFolders: string[]
  toggleFolderCollapsed: (path: string) => void
  /** 格式下拉里已折叠的分类,跨重启保留 */
  collapsedFormatGroups: string[]
  toggleFormatGroup: (type: string) => void
  refreshFolders: () => void
  createFolder: (parentPath?: string) => void
  renameFolder: (path: string, name: string) => void
  cancelFolderRename: () => void
  beginFolderRename: (path: string) => void
  moveFolder: (source: string, target: string, placement: 'before' | 'after' | 'inside') => void
  moveFolderToLibrary: (sourceLibraryId: number, path: string, targetLibraryId: number, destFolder?: string) => void
  trashFolder: (path: string) => void
  /** 侧栏文件夹多选(带库 id:切库不会把旧库的选中带过来) */
  folderSelection: { libraryId: number; paths: string[]; anchor: string | null } | null
  clickFolder: (
    libraryId: number,
    path: string,
    options?: { shift?: boolean; toggle?: boolean; order?: string[] }
  ) => void
  clearFolderSelection: () => void
  moveAssetsToFolder: (assetIds: string[], folder: string) => void

  /* 导航与搜索 */
  nav: NavKey
  setNav: (n: NavKey) => void
  search: string
  setSearch: (s: string) => void
  /** 每个库的标签总分类,key 为库 id */
  tagGroups: Record<string, TagGroupDefinition[]>
  setTagGroups: (libraryId: number, groups: TagGroupDefinition[]) => void

  /* 筛选 */
  filters: Filters
  setFilter: (k: Exclude<keyof Filters, 'tags'>, v: string) => void
  setTags: (tags: string[]) => void
  stripColor: string | null
  setStripColor: (hex: string | null) => void
  cbarOpen: boolean
  toggleCbar: () => void

  /* 视图 */
  view: ViewMode
  setView: (v: ViewMode) => void
  colw: number
  setColw: (n: number) => void
  sideWidth: number
  setSideWidth: (n: number) => void
  inspHidden: boolean
  toggleInspector: () => void
  /** 三维预览:实体/渲染模式与 HDR 环境 */
  modelShade: ModelShade
  setModelShade: (mode: ModelShade) => void
  modelHdr: HdrId
  setModelHdr: (id: HdrId) => void
  modelHdrRotation: number
  setModelHdrRotation: (value: number) => void
  modelHdrStrength: number
  setModelHdrStrength: (value: number) => void
  modelHdrOpacity: number
  setModelHdrOpacity: (value: number) => void
  modelHdrBlur: number
  setModelHdrBlur: (value: number) => void

  /* 素材数据(可变字段走 store,编辑经 IPC 落库) */
  assets: Asset[]
  setRating: (id: string, v: number) => void
  toggleFavorite: (id: string) => void
  toggleReviewFlag: (id: string) => void
  /** 复制当前库的选中素材；返回是否发起了复制请求 */
  copySelected: () => boolean
  /** 应用内剪贴板:跨库复制/剪切时记住来源库与素材 id */
  assetClipboard: { libraryId: number; ids: number[]; mode: 'copy' | 'cut' } | null
  /** 剪切当前库的选中素材；返回是否记录成功 */
  cutSelected: () => boolean
  /** 把剪贴板素材粘贴到当前库/当前文件夹；返回是否发起了请求 */
  pasteClipboard: () => boolean
  renameAsset: (id: string, name: string) => void
  addTag: (id: string, name: string) => void
  removeTag: (id: string, name: string) => void
  setNote: (id: string, note: string) => void
  setSourceUrl: (id: string, url: string) => void
  trashAsset: (id: string) => void
  /** 批量移入回收站:删除入口统一走这里,避免只处理 activeId */
  trashAssets: (ids: string[]) => void
  restoreAsset: (id: string) => void
  emptyTrash: () => void
  purgeAsset: (id: string) => void
  purgeAssets: (ids: string[]) => void

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
  folderCtxMenu: FolderCtxMenuState | null
  openFolderContextMenu: (path: string, x: number, y: number) => void
  setFolderCtxMenu: (s: FolderCtxMenuState | null) => void

  /* 灯箱 */
  lightboxId: string | null
  /**
   * 灯箱全屏:仅在该窗口内铺满,不改系统窗口状态。
   * 与 lightboxId 一样属瞬时视图态,不持久化——重启后带着全屏打开会让人失去方位感。
   */
  lightboxFullscreen: boolean
  setLightboxFullscreen: (v: boolean) => void
  /**
   * 胶片带展开态:收起时只留底部一条可点开的窄条,把整个舞台还给作品。
   * 与全屏一样是视图偏好而非临时态,所以随 uiPrefs 持久化。
   */
  stripOpen: boolean
  toggleStrip: () => void
  /** CSS 编辑器有未保存改动:关闭与切换素材前必须先确认,避免丢改动 */
  cssDirty: boolean
  setCssDirty: (v: boolean) => void
  openLightbox: (id: string) => void
  closeLightbox: () => void
  stepLightbox: (dir: 1 | -1) => void
}

let tabSeq = 0
let reloadSeq = 0
/** 增量请求自己的序号:不能与全量共用,否则一条增量会把正在飞的全量结果顶掉 */
let deltaSeq = 0
/** 每个打开过的库最近一次完整 assets:切回时先画缓存,不必再等几十 MB IPC */
const assetCache = new Map<number, Asset[]>()
/** 缓存上限:大库一份就是几十 MB,开过的库不能无限累积 */
const ASSET_CACHE_MAX = 4
/** 非活动库收到变更:缓存可能过期,下次激活时后台刷新 */
const dirtyLibraries = new Set<number>()
/** 当前 assets 属于哪个库;切库瞬间仍是上一个库,靠它防止把旧数组错记到新库名下 */
let loadedLibraryId: number | null = null
/** 目录树同样按库缓存:主进程已缓存读盘结果,这里省掉一次 IPC 往返,也避免切库瞬间显示上一个库的树 */
const folderCache = new Map<number, string[]>()

/** 离开一个库前保存它的最新集合(含增量、乐观编辑),切回时才有正确首帧 */
function rememberLoadedAssets(): void {
  const s = useUI.getState()
  if (loadedLibraryId == null || s.mode !== 'library') return
  // 重新插入刷新顺序:刚离开的库是最新用过的,不能被当成最旧淘汰
  assetCache.delete(loadedLibraryId)
  assetCache.set(loadedLibraryId, s.assets)
  trimAssetCache()
}

/** Map 按插入序淘汰最久未用的库 */
function trimAssetCache(): void {
  while (assetCache.size > ASSET_CACHE_MAX) {
    const oldest = assetCache.keys().next().value
    if (oldest == null) return
    assetCache.delete(oldest)
  }
}

export const useUI = create<UIState>((set, get) => {
  /** 编辑动作:本地立即生效 + 库模式落库(失败提示) */
  const edit = (id: string, patch: Record<string, unknown>, local: (a: Asset) => Asset): void => {
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? local(a) : a)) }))
    const a = get().assets.find((x) => x.id === id)
    if (a?.dbId != null && a.libraryId != null) {
      window.windowApi.assets.update(a.libraryId, a.dbId, patch).catch(() => get().showToast('保存失败:数据库写入错误,请重试', 'warn'))
    }
  }

  /** 视图条件变化后,选中/焦点/灯箱只能指向仍然可见的素材。 */
  const applyViewChange = (
    next: Partial<{ nav: NavKey; search: string; filters: Filters; stripColor: string | null }>,
    persist: boolean
  ): boolean => {
    const s = get()
    const view = {
      nav: next.nav ?? s.nav,
      search: next.search ?? s.search,
      filters: next.filters ?? s.filters,
      stripColor: next.stripColor === undefined ? s.stripColor : next.stripColor
    }
    const visible = queryAssets(s.assets, view)
    const visibleIds = new Set(visible.map((a) => a.id))
    const closingLightbox = s.lightboxId != null && !visibleIds.has(s.lightboxId)
    if (closingLightbox && s.cssDirty && !window.confirm('CSS 有未保存的修改,关闭将丢弃这些改动。')) return false

    const selectedIds = s.selectedIds.filter((id) => visibleIds.has(id))
    const focusedCardId = s.focusedCardId && visibleIds.has(s.focusedCardId)
      ? s.focusedCardId
      : (selectedIds[selectedIds.length - 1] ?? null)
    const activeId = s.activeId && visibleIds.has(s.activeId) ? s.activeId : focusedCardId
    const selectionAnchorId = s.selectionAnchorId && visibleIds.has(s.selectionAnchorId) ? s.selectionAnchorId : null
    set({
      ...view,
      ...withSelection(selectedIds),
      selectionAnchorId,
      activeId,
      focusedCardId,
      renaming: s.renaming && activeId != null,
      folderCtxMenu: null,
      lightboxId: closingLightbox ? null : s.lightboxId,
      cssDirty: closingLightbox ? false : s.cssDirty,
      lightboxFullscreen: closingLightbox ? false : s.lightboxFullscreen
    })
    if (persist) persistUiPrefs()
    return true
  }

  /** 切库:上一个库的选中、检查器与灯箱都不得带进新库。 */
  const clearedAssetView = (): Partial<UIState> => ({
    ...withSelection([]),
    selectionAnchorId: null,
    activeId: null,
    focusedCardId: null,
    renaming: false,
    lightboxId: null,
    cssDirty: false,
    lightboxFullscreen: false,
    ctxMenu: null,
    folderCtxMenu: null,
    openMenu: null,
    thumbProgress: null
  })

  const canLeaveLightbox = (): boolean =>
    !get().cssDirty || window.confirm('CSS 有未保存的修改,关闭将丢弃这些改动。')

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
    importDroppedPaths: async (paths, folder) => {
      const tab = get().tabs.find((x) => x.id === get().activeTabId)
      const libraryId = tab?.libraryId
      if (libraryId == null) {
        get().showToast('请先打开一个资源库', 'warn')
        return
      }
      try {
        const result = await window.windowApi.assets.importPaths(libraryId, paths, folder)
        if ('error' in result) {
          get().showToast(result.error, 'warn')
          return
        }
        const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个不支持或库内文件` : ''
        get().showToast(`已导入 ${result.imported} 个素材${skipped}`, result.skipped > 0 ? 'warn' : 'ok')
        get().reloadActiveLibrary()
      } catch {
        get().showToast('导入素材失败，请重试', 'warn')
      }
    },
    importAssetFilesFlow: () => {
      const tab = get().tabs.find((x) => x.id === get().activeTabId)
      const libraryId = tab?.libraryId
      if (libraryId == null) {
        get().showToast('请先打开一个资源库', 'warn')
        return
      }
      get().setOpenMenu(null)
      void (async () => {
        try {
          const paths = await window.windowApi.pickAssetFiles()
          if (paths.length === 0) return
          const nav = get().nav
          const folder = nav.startsWith('folder:') ? nav.slice('folder:'.length) : ''
          await get().importDroppedPaths(paths, folder)
        } catch {
          get().showToast('导入素材失败，请重试', 'warn')
        }
      })()
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
        if (open.id === get().activeTabId) {
          void window.windowApi.library.open(libraryId)
          get().reloadActiveLibrary()
        } else {
          get().openTab(open.id)
        }
      } else {
        get().createLibraryTab(libraryId, name)
      }
    },

    tabs: [],
    activeTabId: '',
    openTab: (id) => {
      const switching = id !== get().activeTabId
      if (switching && !canLeaveLightbox()) return
      if (switching) rememberLoadedAssets()
      set({ activeTabId: id, ...(switching ? clearedAssetView() : {}) })
      get().persistTabs()
      const t = get().tabs.find((x) => x.id === id)
      if (t?.libraryId != null) {
        void window.windowApi.library.open(t.libraryId)
        get().reloadActiveLibrary(true)
      }
      else if (!t?.libraryId) set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'empty' })
    },
    closeTab: (id) => {
      const { tabs, activeTabId } = get()
      const idx = tabs.findIndex((t) => t.id === id)
      const rest = tabs.filter((t) => t.id !== id)
      if (rest.length === 0) return
      const nextActive = id === activeTabId ? (rest[Math.max(0, idx - 1)] ?? rest[0]).id : activeTabId
      const switching = id === activeTabId
      if (switching && !canLeaveLightbox()) return
      if (switching) rememberLoadedAssets()
      const closing = tabs.find((t) => t.id === id)
      if (closing?.libraryId != null && !rest.some((t) => t.libraryId === closing.libraryId)) {
        assetCache.delete(closing.libraryId)
        folderCache.delete(closing.libraryId)
        dirtyLibraries.delete(closing.libraryId)
      }
      set({ tabs: rest, activeTabId: nextActive, ...(switching ? clearedAssetView() : {}) })
      get().persistTabs()
      const t = get().tabs.find((x) => x.id === nextActive)
      if (t?.libraryId != null) {
        void window.windowApi.library.open(t.libraryId)
        get().reloadActiveLibrary(true)
      }
      else set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'empty' })
    },
    createLibraryTab: (libraryId, name) => {
      if (!canLeaveLightbox()) return
      rememberLoadedAssets()
      tabSeq++
      const tab: LibraryTab = { id: `dblib-${libraryId}-${tabSeq}`, name, libraryId }
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, ...clearedAssetView() }))
      get().persistTabs()
      void window.windowApi.library.open(libraryId)
      get().reloadActiveLibrary(true)
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
    transferProgress: null,
    setTransferProgress: (p) => set({ transferProgress: p }),
    thumbRevisions: {},
    markThumbReady: (fingerprint) => set((s) => ({
      thumbRevisions: {
        ...s.thumbRevisions,
        [fingerprint]: (s.thumbRevisions[fingerprint] ?? 0) + 1
      }
    })),
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
      if (t?.libraryId !== libraryId) {
        dirtyLibraries.add(libraryId)
        return
      }
      if (!Array.isArray(assetIds) || assetIds.length === 0) {
        get().reloadActiveLibrary()
        return
      }
      /* 先标脏:这次增量若被切库顶替,缓存就不完整,下次激活必须重拉 */
      dirtyLibraries.add(libraryId)
      const request = ++deltaSeq
      void window.windowApi.assets.rows(libraryId, assetIds).then((r) => {
        if (request !== deltaSeq) return
        /* 请求飞行期间切了库:结果不属于当前界面,缓存留脏标记等下次激活重拉 */
        if (get().tabs.find((x) => x.id === get().activeTabId)?.libraryId !== libraryId) return
        const incoming = r.assets as unknown as Record<string, unknown>[]
        if (!Array.isArray(incoming)) return
        dirtyLibraries.delete(libraryId)
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
          // 增量事件只追加新路径;保留数据库返回的手动顺序,禁止按字母重排已有节点。
          const knownFolders = new Set(s.physicalFolderPaths)
          const additions: string[] = []
          for (const a of rows) for (const f of a.folders) {
            if (!knownFolders.has(f)) {
              knownFolders.add(f)
              additions.push(f)
            }
          }
          const physicalFolderPaths = [...s.physicalFolderPaths, ...additions]
          if (additions.length > 0) folderCache.set(libraryId, physicalFolderPaths)
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
    reloadActiveLibrary: (reuseCache = false) => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) {
        set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'empty' })
        return
      }
      const libraryId = t.libraryId
      const cached = assetCache.get(libraryId)
      const cachedFolders = folderCache.get(libraryId)
      /* 切库瞬间先把树换成目标库的:主进程虽已缓存,一次 IPC 往返也足够让上一个库的目录闪在屏幕上 */
      set(cachedFolders
        ? { folderPaths: cachedFolders, physicalFolderPaths: cachedFolders }
        : { folderPaths: [], physicalFolderPaths: [], folderEditPath: null })
      /* 第一次打开这个库没有缓存:宁可短暂空网格,也不让上一个库的卡片留在新标签页下被误操作 */
      if (reuseCache && !cached) {
        loadedLibraryId = null
        set({ assets: [], mode: 'library' })
      }
      /* 同一个库的主动刷新不画缓存:内存里那一份比上次离开时更新(乐观编辑、增量合并) */
      if (cached && !(get().mode === 'library' && loadedLibraryId === libraryId)) {
        loadedLibraryId = libraryId
        // 命中缓存也刷新 LRU 顺序,连续来回切时别把正在用的库淘汰掉
        assetCache.delete(libraryId)
        assetCache.set(libraryId, cached)
        set({ assets: cached, mode: 'library' })
      }
      const request = ++reloadSeq
      /* 已被更新的请求顶替、或用户已切到别的库:这次结果(成功或失败)都不再属于当前界面 */
      const superseded = (): boolean =>
        request !== reloadSeq || get().tabs.find((x) => x.id === get().activeTabId)?.libraryId !== libraryId
      const fail = (): void => {
        if (superseded()) return
        /* 有缓存就不退回错误态:一次刷新失败不该把可用的列表清空 */
        if (cached) {
          /* 标脏:下次切回来要重试,否则缓存会一直挡住重拉 */
          dirtyLibraries.add(libraryId)
          get().showToast('素材列表刷新失败，继续显示缓存', 'warn')
          return
        }
        set({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'error' })
        get().showToast('素材库加载失败，请重试', 'warn')
      }
      /* 目录树请求先发:assets 全量有几十 MB,主进程同步查询与序列化会占住事件循环,
         晚发一步的 folders:list 只能等它发完才回包,侧边栏就空着。 */
      void window.windowApi.folders.list(libraryId).then((folders) => {
        if (superseded()) return
        const folderPaths = 'paths' in folders ? folders.paths : []
        if ('paths' in folders) folderCache.set(libraryId, folderPaths)
        set((s) => {
          const activeFolder = s.nav.startsWith('folder:') ? s.nav.slice('folder:'.length) : null
          return {
            folderPaths,
            physicalFolderPaths: folderPaths,
            folderEditPath: s.folderEditPath && folderPaths.includes(s.folderEditPath) ? s.folderEditPath : null,
            nav: activeFolder && !folderPaths.includes(activeFolder) ? 'all' : s.nav
          }
        })
      }).catch(() => {
        if (superseded()) return
        /* 目录树读失败就不展示上一棵树(可能属于别的库),素材本身照常可用 */
        set({ folderPaths: [], physicalFolderPaths: [], folderEditPath: null })
        get().showToast('素材库文件夹加载失败，请重试', 'warn')
      })
      /* 切回未变更的库:缓存就是最新,不再拉几十 MB */
      if (reuseCache && cached && !dirtyLibraries.has(libraryId)) return
      void (async () => {
        const pages: Record<string, unknown>[] = []
        let before: { importedAt: string; id: number } | undefined
        let library: unknown
        for (;;) {
          const r = before
            ? await window.windowApi.assets.list(libraryId, { before })
            : await window.windowApi.assets.list(libraryId)
          if (!('assets' in r) || !Array.isArray(r.assets)) {
            fail()
            return
          }
          library = r.library
          pages.push(...(r.assets as unknown as Record<string, unknown>[]))
          if (!r.next) break
          before = r.next
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        const r = { library, assets: pages }
        if (superseded()) return
        const list = r.assets.map(rowToAsset)
        assetCache.set(libraryId, list)
        dirtyLibraries.delete(libraryId)
        loadedLibraryId = libraryId
        set({ assets: list, mode: 'library' })
      })().catch(fail)
    },
    folderPaths: [],
    physicalFolderPaths: [],
    folderEditPath: null,
    folderSelection: null,
    collapsedFolders: [],
    toggleFolderCollapsed: (path) => {
      set((s) => ({
        collapsedFolders: s.collapsedFolders.includes(path)
          ? s.collapsedFolders.filter((p) => p !== path)
          : [...s.collapsedFolders, path]
      }))
      persistUiPrefs()
    },
    collapsedFormatGroups: [],
    toggleFormatGroup: (type) => {
      set((s) => ({
        collapsedFormatGroups: s.collapsedFormatGroups.includes(type)
          ? s.collapsedFormatGroups.filter((t) => t !== type)
          : [...s.collapsedFormatGroups, type]
      }))
      persistUiPrefs()
    },
    refreshFolders: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      const libraryId = t?.libraryId
      if (libraryId == null) return
      void window.windowApi.folders.list(libraryId).then((r) => {
        /* 失败不改目录树:留下与磁盘不符的中间态比维持原样更危险 */
        if (!('paths' in r)) {
          get().showToast('目录列表刷新失败，目录树保持原样', 'warn')
          return
        }
        folderCache.set(libraryId, r.paths)
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
    createFolder: (parentPath = '') => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      set({ folderCtxMenu: null })
      void window.windowApi.folders.create(t.libraryId, parentPath).then((r) => {
        if ('error' in r) {
          get().showToast(r.error, 'warn')
          return
        }
        set((s) => ({
          folderEditPath: r.path,
          nav: `folder:${r.path}` as NavKey,
          collapsedFolders: parentPath ? s.collapsedFolders.filter((path) => path !== parentPath) : s.collapsedFolders
        }))
        get().refreshFolders()
      }).catch(() => {
        get().showToast('新建子文件夹失败,请重试', 'warn')
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
        set((s) => ({
          nav: rebaseFolderNav(s.nav, path, r.path),
          collapsedFolders: s.collapsedFolders.map((item) => rebaseFolderPath(item, path, r.path))
        }))
        get().refreshFolders()
      })
    },
    cancelFolderRename: () => set({ folderEditPath: null }),
    beginFolderRename: (path) => set({
      folderEditPath: path,
      nav: `folder:${path}` as NavKey,
      folderCtxMenu: null
    }),
    moveFolder: (source, target, placement) => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      const optimistic = optimisticFolderMove(get().folderPaths, source, target, placement)
      if (optimistic.conflict) {
        get().showToast('目标位置已有同名文件夹', 'warn')
        return
      }
      set((s) => ({
        folderPaths: optimistic.paths,
        physicalFolderPaths: optimistic.paths,
        nav: rebaseFolderNav(s.nav, source, optimistic.path),
        folderEditPath: s.folderEditPath ? rebaseFolderPath(s.folderEditPath, source, optimistic.path) : s.folderEditPath,
        collapsedFolders: s.collapsedFolders.map((item) => rebaseFolderPath(item, source, optimistic.path)),
        assets: s.assets.map((asset) => {
          if (asset.libraryId !== t.libraryId || !asset.relPath) return asset
          const relPath = rebaseFolderPath(asset.relPath, source, optimistic.path)
          if (relPath === asset.relPath) return asset
          const fingerprint = encodeURIComponent(String(asset.fingerprint ?? ''))
          const originalUrl = `media://${asset.libraryId}/${encodeURIComponent(relPath)}?v=${fingerprint}`
          const previewUrl = thumbUrl(originalUrl)
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
        set((s) => ({
          nav: rebaseFolderNav(s.nav, optimistic.path, r.path),
          collapsedFolders: s.collapsedFolders.map((item) => rebaseFolderPath(item, optimistic.path, r.path))
        }))
        get().reloadActiveLibrary()
      }).catch(() => {
        get().showToast('移动文件夹失败,请重试', 'warn')
        get().reloadActiveLibrary()
      })
    },
    /**
     * 文件夹跨库移动:结构映射、同名避让、源目录清理全在主进程做,这里只负责提示与刷新。
     *
     * 不做乐观更新 —— 跨库落点(目标库同名目录合并、同名文件 `名称 (2).ext` 避让)
     * 由主进程决定,先猜一个再回滚只会让界面闪两次。`assets:changed` 会把两侧都刷新。
     */
    moveFolderToLibrary: (sourceLibraryId, path, targetLibraryId, destFolder = '') => {
      const targetName = get().libraries.find((lib) => lib.id === targetLibraryId)?.name ?? '目标资产库'
      void window.windowApi.folders.transfer(sourceLibraryId, targetLibraryId, path, destFolder).then((result) => {
        get().setTransferProgress(null)
        if ('error' in result) {
          get().showToast(result.error, 'warn')
          return
        }
        const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个不可用素材` : ''
        const kept = result.keptSource > 0 ? `，${result.keptSource} 个源文件未能删除，目录已保留` : ''
        get().showToast(
          `已移动到「${targetName}」：${result.transferred} 个素材${skipped}${kept}`,
          result.skipped > 0 || result.keptSource > 0 ? 'warn' : 'ok'
        )
        get().reloadActiveLibrary()
      }).catch(() => {
        get().setTransferProgress(null)
        get().showToast('移动到资产库失败,请重试', 'warn')
      })
    },
    /**
     * 侧栏点选文件夹的选中语义(与卡片一致):
     * - 无修饰键:替换为单选(导航由调用方 setNav 负责)
     * - Shift:从锚点按可见顺序重算区间并整体替换,锚点不动,便于继续缩选区
     * - Ctrl/Cmd:单项 toggle,其余保持不变
     */
    clickFolder: (libraryId, path, options) =>
      set((s) => {
        const previous =
          s.folderSelection?.libraryId === libraryId
            ? s.folderSelection
            : { libraryId, paths: [] as string[], anchor: null }
        if (options?.shift) {
          const order = options.order ?? []
          const anchor = previous.anchor ?? path
          const start = order.indexOf(anchor)
          const end = order.indexOf(path)
          const range =
            start >= 0 && end >= 0 ? order.slice(Math.min(start, end), Math.max(start, end) + 1) : [path]
          return { folderSelection: { libraryId, paths: range, anchor } }
        }
        if (options?.toggle) {
          const paths = previous.paths.includes(path)
            ? previous.paths.filter((item) => item !== path)
            : [...previous.paths, path]
          return { folderSelection: { libraryId, paths, anchor: path } }
        }
        return { folderSelection: { libraryId, paths: [path], anchor: path } }
      }),
    clearFolderSelection: () => {
      if (get().folderSelection) set({ folderSelection: null })
    },
    trashFolder: (path) => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      const libraryId = t?.libraryId
      if (libraryId == null) return
      set({ folderCtxMenu: null })
      const prefix = `${path}/`
      const affectedAssets = get().assets.filter(
        (asset) => asset.libraryId === libraryId && (asset.relPath ?? '').startsWith(prefix)
      )
      const affected = affectedAssets.length
      const deletedIds = new Set(affectedAssets.map((asset) => asset.id))
      const label = path.split('/').pop() ?? path
      if (!window.confirm(
        `将「${label}」及其全部内容移入系统回收站？素材库会移除该目录下 ${affected} 条素材记录与派生缓存。`
      )) return

      const clearDeletedState = (s: ReturnType<typeof useUI.getState>): Partial<ReturnType<typeof useUI.getState>> => {
        const activeFolder = s.nav.startsWith('folder:') ? s.nav.slice('folder:'.length) : null
        const selectedIds = s.selectedIds.filter((id) => !deletedIds.has(id))
        const activeId = s.activeId && deletedIds.has(s.activeId) ? null : s.activeId
        const focusedCardId = s.focusedCardId && deletedIds.has(s.focusedCardId) ? null : s.focusedCardId
        const selectionAnchorId =
          s.selectionAnchorId && deletedIds.has(s.selectionAnchorId) ? null : s.selectionAnchorId
        return {
          ...withSelection(selectedIds),
          activeId,
          focusedCardId,
          selectionAnchorId,
          renaming: s.renaming && (!s.activeId || !deletedIds.has(s.activeId)),
          nav: activeFolder === path || activeFolder?.startsWith(prefix) ? 'all' : s.nav,
          folderEditPath:
            s.folderEditPath === path || s.folderEditPath?.startsWith(prefix) ? null : s.folderEditPath,
          collapsedFolders: s.collapsedFolders.filter((item) => item !== path && !item.startsWith(prefix)),
          lightboxId: s.lightboxId && deletedIds.has(s.lightboxId) ? null : s.lightboxId,
          cssDirty: s.lightboxId && deletedIds.has(s.lightboxId) ? false : s.cssDirty
        }
      }

      void window.windowApi.folders.trash(libraryId, path).then((r) => {
        if ('error' in r) {
          get().showToast(r.error, 'warn')
          get().reloadActiveLibrary()
          return
        }
        set((s) => clearDeletedState(s))
        /* 整棵子树已删:缓存先扣掉这些路径,不用重读盘也不会留着幽灵目录 */
        const stale = folderCache.get(libraryId)
        if (stale) folderCache.set(libraryId, stale.filter((item) => item !== path && !item.startsWith(prefix)))
        get().showToast(r.removedAssets > 0 ? `已移入回收站，移除 ${r.removedAssets} 条素材记录` : '已移入回收站')
        get().reloadActiveLibrary()
      }).catch(() => {
        get().showToast('删除文件夹失败,请重试', 'warn')
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
    // 当前灯箱素材不在新视图时退出；选中/焦点同样只保留仍可见的项。
    // 否则切换目录后 Del 会作用在屏幕上看不到的旧素材上。
    setNav: (nav) => {
      applyViewChange({ nav }, true)
      /* 离开文件夹视图(点了「全部素材」这类系统视图)就没必要留着文件夹选中 */
      if (get().nav === nav && !nav.startsWith('folder:')) set({ folderSelection: null })
    },
    search: '',
    setSearch: (search) => {
      applyViewChange({ search }, false)
    },
    tagGroups: {},
    setTagGroups: (libraryId, groups) => {
      set((s) => {
        const key = String(libraryId)
        const next = { ...s.tagGroups }
        if (groups.length === 0) delete next[key]
        else next[key] = groups
        return { tagGroups: next }
      })
      persistUiPrefs()
    },

    filters: DEFAULT_FILTERS,
    setFilter: (k, v) => {
      applyViewChange({ filters: { ...get().filters, [k]: v } }, false)
    },
    setTags: (tags) => {
      applyViewChange({ filters: { ...get().filters, tags: [...new Set(tags)] } }, false)
    },
    stripColor: null,
    setStripColor: (stripColor) => {
      applyViewChange({ stripColor }, false)
    },
    cbarOpen: false,
    toggleCbar: () => {
      set((s) => ({ cbarOpen: !s.cbarOpen, openMenu: null, folderCtxMenu: null }))
      persistUiPrefs()
    },

    view: 'waterfall',
    setView: (view) => {
      set({ view, openMenu: null, folderCtxMenu: null })
      persistUiPrefs()
    },
    colw: COLW_DEFAULT,
    setColw: (colw) => {
      set({ colw })
      // S2-9:Ctrl+滚轮每 tick 都到这,落库防抖 300ms(与主窗口 resize 防抖策略对齐),
      // 避免高频 IPC + SQLite 写;视口令牌由 App.tsx 立即更新,不等待防抖
      if (colwPersistTimer) clearTimeout(colwPersistTimer)
      colwPersistTimer = setTimeout(persistUiPrefs, 300)
    },
    inspHidden: false,
    sideWidth: SIDEBAR_DEFAULT,
    setSideWidth: (sideWidth) => {
      set({ sideWidth: clampSidebarWidth(sideWidth) })
      if (sideWidthPersistTimer) clearTimeout(sideWidthPersistTimer)
      sideWidthPersistTimer = setTimeout(persistUiPrefs, 300)
    },
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
    modelHdrRotation: DEFAULT_HDR_SETTINGS.rotation,
    setModelHdrRotation: (modelHdrRotation) => {
      set({ modelHdrRotation })
      scheduleHdrPersist()
    },
    modelHdrStrength: DEFAULT_HDR_SETTINGS.strength,
    setModelHdrStrength: (modelHdrStrength) => {
      set({ modelHdrStrength })
      scheduleHdrPersist()
    },
    modelHdrOpacity: DEFAULT_HDR_SETTINGS.opacity,
    setModelHdrOpacity: (modelHdrOpacity) => {
      set({ modelHdrOpacity })
      scheduleHdrPersist()
    },
    modelHdrBlur: DEFAULT_HDR_SETTINGS.blur,
    setModelHdrBlur: (modelHdrBlur) => {
      set({ modelHdrBlur })
      scheduleHdrPersist()
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
      set({ assetClipboard: { libraryId, ids, mode: 'copy' } })
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
    assetClipboard: null,
    cutSelected: () => {
      const tab = get().tabs.find((item) => item.id === get().activeTabId)
      const libraryId = tab?.libraryId
      if (libraryId == null) return false
      const ids = get().assets
        .filter((asset) => get().selectedSet.has(asset.id) && asset.dbId != null && asset.libraryId === libraryId && !asset.deletedAt && !asset.missing)
        .map((asset) => asset.dbId as number)
      if (ids.length === 0) return false
      set({ assetClipboard: { libraryId, ids, mode: 'cut' } })
      get().showToast(`已剪切 ${ids.length} 个素材，切换到目标资源库后按 Ctrl V 粘贴`)
      return true
    },
    pasteClipboard: () => {
      const clipboard = get().assetClipboard
      const tab = get().tabs.find((item) => item.id === get().activeTabId)
      const targetLibraryId = tab?.libraryId
      if (!clipboard || targetLibraryId == null) return false
      const nav = get().nav
      const folder = nav.startsWith('folder:') ? nav.slice('folder:'.length) : ''
      void window.windowApi.assets.transfer(clipboard.libraryId, targetLibraryId, clipboard.ids, folder, clipboard.mode).then((result) => {
        get().setTransferProgress(null)
        if ('error' in result) {
          get().showToast(result.error, 'warn')
          return
        }
        if (clipboard.mode === 'cut') {
          /* 剪切是移动语义:同一批只粘贴一次,避免二次粘贴得到重复副本 */
          set({ assetClipboard: null })
        }
        /* 粘贴目标就是当前库:无论跨库与否都要重拉,新入库的行才会出现在网格里 */
        get().reloadActiveLibrary()
        const extra = result.skipped > 0 ? `，跳过 ${result.skipped} 个不可用素材` : ''
        const kept = result.keptSource > 0 ? `，${result.keptSource} 个源文件未能删除，已保留原记录` : ''
        get().showToast(
          `${clipboard.mode === 'cut' ? '已移动' : '已复制'} ${result.transferred} 个素材${extra}${kept}`,
          result.skipped > 0 || result.keptSource > 0 ? 'warn' : 'ok'
        )
      }).catch(() => {
        get().setTransferProgress(null)
        get().showToast(`${clipboard.mode === 'cut' ? '移动' : '复制'}素材失败,请重试`, 'warn')
      })
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
    trashAsset: (id) => get().trashAssets([id]),
    trashAssets: (ids) => {
      const requested = new Set(ids)
      const targets = get().assets.filter((a) => requested.has(a.id) && !a.deletedAt)
      if (targets.length === 0) return
      const now = new Date().toISOString()
      const deletedIds = new Set(targets.map((a) => a.id))
      set((s) => ({
        assets: s.assets.map((a) => deletedIds.has(a.id)
          ? { ...a, deletedAt: now, previewUrl: a.originalUrl }
          : a),
        ...withSelection(s.selectedIds.filter((x) => !deletedIds.has(x))),
        activeId: s.activeId && deletedIds.has(s.activeId) ? null : s.activeId,
        focusedCardId: s.focusedCardId && deletedIds.has(s.focusedCardId) ? null : s.focusedCardId,
        selectionAnchorId: s.selectionAnchorId && deletedIds.has(s.selectionAnchorId) ? null : s.selectionAnchorId,
        renaming: s.renaming && (!s.activeId || !deletedIds.has(s.activeId)),
        lightboxId: s.lightboxId && deletedIds.has(s.lightboxId) ? null : s.lightboxId,
        cssDirty: s.lightboxId && deletedIds.has(s.lightboxId) ? false : s.cssDirty,
        ctxMenu: null
      }))
      const writes = targets
        .filter((a) => a.dbId != null && a.libraryId != null)
        .map((a) => window.windowApi.assets.update(a.libraryId as number, a.dbId as number, { deleted_at: now })
          .then((r) => r?.ok === true)
          .catch(() => false))
      void Promise.all(writes).then((results) => {
        const failed = results.filter((ok) => !ok).length
        if (failed === 0) return
        get().showToast(`有 ${failed} 个素材未能移入回收站,请重试`, 'warn')
        get().reloadActiveLibrary()
      })
    },
      restoreAsset: (id) => edit(id, { deleted_at: null }, (a) => ({ ...a, deletedAt: undefined, previewUrl: a.originalUrl ? thumbUrl(a.originalUrl) : a.previewUrl })),
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
    purgeAsset: (id) => get().purgeAssets([id]),
    purgeAssets: (ids) => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      const requested = new Set(ids)
      const targets = get().assets.filter((a) =>
        requested.has(a.id) && a.deletedAt != null && a.dbId != null && a.libraryId === t.libraryId
      )
      const dbIds = targets.map((a) => a.dbId as number)
      if (dbIds.length === 0) return
      if (!window.confirm(`彻底删除选中的 ${dbIds.length} 条素材会移除数据库记录与缩略图缓存,不删除磁盘原文件。确定继续吗?`)) return
      const done = (ok: boolean): void => {
        if (!ok) get().showToast('彻底删除失败，记录未被清除', 'warn')
        void get().reloadActiveLibrary()
      }
      void window.windowApi.assets.purge(t.libraryId, dbIds)
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
    // 框选拖动会连续调用这里:焦点与检查器必须跟着选区走,不能停在框选前那张。
    setSelectedIds: (ids) => {
      const last = ids[ids.length - 1] ?? null
      set({ ...withSelection(ids), selectionAnchorId: last, activeId: last, focusedCardId: last })
    },
    setFocusedCard: (focusedCardId) => set({ focusedCardId }),
    clearSelection: () =>
      set({ ...withSelection([]), selectionAnchorId: null, activeId: null, focusedCardId: null }),

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
    setOpenMenu: (openMenu) => set(openMenu ? { openMenu, cbarOpen: false, folderCtxMenu: null } : { openMenu }),
    ctxMenu: null,
    setCtxMenu: (ctxMenu) => set(ctxMenu ? { ctxMenu, folderCtxMenu: null } : { ctxMenu }),
    folderCtxMenu: null,
    openFolderContextMenu: (path, x, y) => {
      const t = get().tabs.find((item) => item.id === get().activeTabId)
      if (t?.libraryId == null) return
      set({
        folderCtxMenu: { path, x, y, libraryId: t.libraryId },
        ctxMenu: null,
        openMenu: null,
        cbarOpen: false
      })
    },
    setFolderCtxMenu: (folderCtxMenu) => set({ folderCtxMenu }),

    lightboxId: null,
    lightboxFullscreen: false,
    setLightboxFullscreen: (v) => set({ lightboxFullscreen: v }),
    stripOpen: true,
    toggleStrip: () => {
      set((s) => ({ stripOpen: !s.stripOpen }))
      persistUiPrefs()
    },
    cssDirty: false,
    setCssDirty: (v) => set({ cssDirty: v }),
    openLightbox: (id) => {
      const s = get()
      // 胶片带换片走这里,与 closeLightbox/stepLightbox 共用同一套未保存 CSS 确认。
      if (s.lightboxId && s.lightboxId !== id && s.cssDirty &&
        !window.confirm('CSS 有未保存的修改,切换素材将丢弃这些改动。')) return
      // 同步 activeId:右侧已有的检查器渲染的就是它,这样灯箱里看的那张与检查器显示的始终一致
      set((state) => ({
        lightboxId: id,
        activeId: id,
        focusedCardId: id,
        cssDirty: false,
        // 从胶片带换片时保留全屏;从网格首次打开时仍从普通布局开始。
        lightboxFullscreen: state.lightboxId ? state.lightboxFullscreen : false,
        openMenu: null,
        ctxMenu: null,
        folderCtxMenu: null
      }))
    },
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
