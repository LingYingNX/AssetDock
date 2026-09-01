import { create } from 'zustand'
import type { Asset, LibraryTab, NavKey, PaletteColor } from '../data/types'
import { ASSETS, TAGS } from '../data/dataset'
import { DEFAULT_FILTERS, type Filters } from '../data/query'

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

/** 主进程资产行 → Asset */
function rowToAsset(r: Record<string, unknown>): Asset {
  const tags = (r.tags as { name: string; color: string }[]) ?? []
  const segs = String(r.rel_path ?? '').split('/')
  return {
    id: `a${r.id as number}`,
    dbId: r.id as number,
    libraryId: r.library_id as number,
    relPath: r.rel_path as string,
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
    folders: segs.slice(0, -1).map((_, i) => segs.slice(0, i + 1).join('/')),
    note: (r.note as string) ?? '',
    sourceUrl: (r.source_url as string) ?? undefined,
    palette: JSON.parse((r.palette as string) || '[]') as PaletteColor[],
    previewUrl: `thumb://${r.fingerprint as string}.webp`,
    originalUrl: `media://${r.library_id as number}/${encodeURIComponent(r.rel_path as string)}`,
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
  createLibraryFlow: () => void
  openLibrary: (libraryId: number, name: string) => void

  /* 标题栏库标签页 */
  tabs: LibraryTab[]
  activeTabId: string
  openTab: (id: string) => void
  closeTab: (id: string) => void
  addTab: () => void
  createLibraryTab: (libraryId: number, name: string) => void
  persistTabs: () => void

  /* 数据源 */
  mode: 'demo' | 'library'
  scanProgress: string | null
  thumbNonce: number
  setAssets: (list: Asset[]) => void
  reloadActiveLibrary: () => void
  bumpThumb: () => void

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

  /* 选中与焦点 */
  selectedIds: string[]
  activeId: string | null
  focusedCardId: string | null
  clickCard: (id: string) => void
  setFocusedCard: (id: string | null) => void
  clearSelection: () => void

  /* 检查器文件名编辑 */
  renaming: boolean
  setRenaming: (v: boolean) => void

  /* 菜单 */
  openMenu: string | null
  setOpenMenu: (id: string | null) => void
  ctxMenu: CtxMenuState | null
  setCtxMenu: (s: CtxMenuState | null) => void

  /* 灯箱 */
  lightboxId: string | null
  openLightbox: (id: string) => void
  closeLightbox: () => void
  stepLightbox: (dir: 1 | -1) => void
}

const initialTabs: LibraryTab[] = [
  { id: 'lib-1', name: '品牌资产 2026' },
  { id: 'lib-2', name: '个人灵感库' }
]

let tabSeq = 0

export const useUI = create<UIState>((set, get) => {
  /** 编辑动作:本地立即生效 + 库模式落库(失败提示) */
  const edit = (id: string, patch: Record<string, unknown>, local: (a: Asset) => Asset): void => {
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? local(a) : a)) }))
    const a = get().assets.find((x) => x.id === id)
    if (a?.dbId != null) {
      window.windowApi.assets.update(a.dbId, patch).catch(() => alert('保存失败:数据库写入错误,请重试'))
    }
  }

  return {
    libraries: [],
    setLibraries: (libraries) => set({ libraries }),
    createLibraryFlow: () => {
      void window.windowApi.pickFolder().then(async (folder) => {
        if (!folder) return
        const libs = get().libraries
        const bound = libs.find((l) => l.path.toLowerCase() === folder.toLowerCase())
        if (bound) {
          get().openLibrary(bound.id, bound.name)
          return
        }
        const r = await window.windowApi.library.create(folder)
        if ('error' in r) {
          alert(r.error)
          return
        }
        get().setLibraries([...libs, r])
        get().openLibrary(r.id, r.name)
      })
    },
    openLibrary: (libraryId, name) => {
      set({ scanProgress: null })
      const open = get().tabs.find((t) => t.libraryId === libraryId)
      if (open) {
        set({ activeTabId: open.id })
      } else {
        get().createLibraryTab(libraryId, name)
      }
      get().reloadActiveLibrary()
    },

    tabs: initialTabs,
    activeTabId: initialTabs[0].id,
    openTab: (id) => {
      set({ activeTabId: id })
      get().persistTabs()
      const t = get().tabs.find((x) => x.id === id)
      if (t?.libraryId != null) get().reloadActiveLibrary()
      else if (!t?.libraryId) set({ assets: ASSETS, mode: 'demo' })
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
      if (t?.libraryId != null) get().reloadActiveLibrary()
      else set({ assets: ASSETS, mode: 'demo' })
    },
    addTab: () => {
      // 「+」菜单路径:打开库入口下拉(新建 + 已绑定库列表)
      set({ openMenu: 'm-libs' })
    },
    createLibraryTab: (libraryId, name) => {
      tabSeq++
      const tab: LibraryTab = { id: `dblib-${libraryId}-${tabSeq}`, name, libraryId }
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
      get().persistTabs()
      get().reloadActiveLibrary()
    },
    persistTabs: () => {
      const ids = get().tabs.filter((t) => t.libraryId != null).map((t) => t.libraryId as number)
      void window.windowApi.tabs.save(ids)
      void window.windowApi.state.set('activeTabLibrary', String(get().tabs.find((t) => t.id === get().activeTabId)?.libraryId ?? ''))
    },

    mode: 'demo',
    scanProgress: null,
    thumbNonce: 0,
    setAssets: (list) => set({ assets: list }),
    reloadActiveLibrary: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) {
        set({ assets: ASSETS, mode: 'demo' })
        return
      }
      void window.windowApi.assets.list(t.libraryId).then((r) => {
        const data = r as { library?: unknown; assets?: Record<string, unknown>[] }
        if (Array.isArray(data?.assets)) set({ assets: data.assets.map(rowToAsset), mode: 'library' })
      })
    },
    bumpThumb: () => set((s) => ({ thumbNonce: s.thumbNonce + 1 })),

    nav: 'all',
    setNav: (nav) => set({ nav }),
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
    toggleCbar: () => set((s) => ({ cbarOpen: !s.cbarOpen })),

    view: 'waterfall',
    setView: (view) => set({ view, openMenu: null }),
    colw: 232,
    setColw: (colw) => set({ colw }),
    inspHidden: false,
    toggleInspector: () => set((s) => ({ inspHidden: !s.inspHidden })),

    assets: ASSETS,
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
    renameAsset: (id, name) => {
      edit(id, { name }, (a) => ({ ...a, name }))
      set({ renaming: false })
    },
    addTag: (id, name) => {
      const a = get().assets.find((x) => x.id === id)
      if (!a || a.tags.some((t) => t.name === name)) return
      edit(id, {}, (x) => ({ ...x, tags: [...x.tags, { name, color: TAG_COLOR(name) }] }))
      if (a.dbId != null) void window.windowApi.assets.addTag(a.dbId, name)
    },
    removeTag: (id, name) => {
      edit(id, {}, (x) => ({ ...x, tags: x.tags.filter((t) => t.name !== name) }))
      const a = get().assets.find((x) => x.id === id)
      if (a?.dbId != null) void window.windowApi.assets.removeTag(a.dbId, name)
    },
    setNote: (id, note) => edit(id, { note }, (a) => ({ ...a, note })),
    setSourceUrl: (id, url) => edit(id, { source_url: url || null }, (a) => ({ ...a, sourceUrl: url || undefined })),
    trashAsset: (id) => {
      const now = new Date().toISOString()
      edit(id, { deleted_at: now }, (a) => ({ ...a, deletedAt: now }))
      set((s) => ({
        selectedIds: s.selectedIds.filter((x) => x !== id),
        activeId: s.activeId === id ? null : s.activeId,
        lightboxId: s.lightboxId === id ? null : s.lightboxId,
        ctxMenu: null
      }))
    },
    restoreAsset: (id) => edit(id, { deleted_at: null }, (a) => ({ ...a, deletedAt: undefined })),
    emptyTrash: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      void window.windowApi.assets.emptyTrash(t.libraryId).then(() => get().reloadActiveLibrary())
    },

    selectedIds: [],
    activeId: null,
    focusedCardId: null,
    clickCard: (id) =>
      set((s) => ({
        selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
        activeId: id,
        focusedCardId: id
      })),
    setFocusedCard: (focusedCardId) => set({ focusedCardId }),
    clearSelection: () => set({ selectedIds: [] }),

    renaming: false,
    setRenaming: (renaming) => set({ renaming }),

    openMenu: null,
    setOpenMenu: (openMenu) => set({ openMenu }),
    ctxMenu: null,
    setCtxMenu: (ctxMenu) => set({ ctxMenu }),

    lightboxId: null,
    openLightbox: (id) => set({ lightboxId: id, openMenu: null, ctxMenu: null }),
    closeLightbox: () => set({ lightboxId: null }),
    stepLightbox: (dir) => {
      const { lightboxId, assets } = get()
      const visible = assets.filter((a) => !a.deletedAt)
      if (visible.length === 0) return
      const idx = visible.findIndex((a) => a.id === lightboxId)
      if (idx < 0) return
      const next = Math.min(visible.length - 1, Math.max(0, idx + dir))
      set({ lightboxId: visible[next].id })
    }
  }
})

export { rowToAsset }
