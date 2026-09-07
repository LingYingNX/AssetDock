import { create } from 'zustand'
import type { Asset, LibraryTab, NavKey, PaletteColor } from '../data/types'
import { TAGS } from '../data/dataset'
import { DEFAULT_FILTERS, queryAssets, type Filters } from '../data/query'

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
  const relPath = String(r.rel_path ?? '')
  const folderPath = typeof r.folder_path === 'string' && r.folder_path ? r.folder_path : null
  const sourceIndexId = typeof r.source_index_id === 'number' ? r.source_index_id : undefined
  const folderChain = (path: string): string[] => {
    const parts = path.split('/').filter(Boolean).slice(0, -1)
    return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
  }
  const folders = sourceIndexId == null
    ? folderChain(relPath)
    : folderPath
      ? folderChain(`${folderPath}/_`)
      : []
  return {
    id: `a${r.id as number}`,
    dbId: r.id as number,
    libraryId: r.library_id as number,
    relPath,
    fingerprint: r.fingerprint as string,
    missing: (r.missing as number) === 1,
    sourceIndexId,
    indexName: (r.index_name as string) ?? undefined,
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
    previewUrl: `thumb://${r.fingerprint as string}.webp`,
    originalUrl: `media://${r.library_id as number}/${encodeURIComponent(r.rel_path as string)}${sourceIndexId != null ? `?source=${sourceIndexId}` : ''}`,
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
  indexFlow: () => void
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
  mode: 'empty' | 'library'
  scanProgress: string | null
  thumbNonce: number
  setAssets: (list: Asset[]) => void
  reloadActiveLibrary: () => void
  bumpThumb: () => void
  folderPaths: string[]
  folderEditPath: string | null
  refreshFolders: () => void
  createFolder: () => void
  renameFolder: (path: string, name: string) => void
  cancelFolderRename: () => void
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
  indexes: { id: number; name: string; path: string }[]
  setIndexes: (list: { id: number; name: string; path: string }[]) => void
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
        if (r.warning) alert(r.warning)
        get().openLibrary(r.id, r.name)
      })
    },
    indexFlow: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      const libraryId = t?.libraryId
      if (libraryId == null) {
        alert('请先新建或打开一个素材库,再索引目录')
        return
      }
      void window.windowApi.pickFolder().then(async (folder) => {
        if (!folder) return
        const r = await window.windowApi.index.add(libraryId, folder)
        if ('error' in r) {
          alert(r.error)
          return
        }
        get().reloadActiveLibrary()
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

    tabs: [],
    activeTabId: '',
    openTab: (id) => {
      set({ activeTabId: id })
      get().persistTabs()
      const t = get().tabs.find((x) => x.id === id)
      if (t?.libraryId != null) get().reloadActiveLibrary()
      else if (!t?.libraryId) set({ assets: [], folderPaths: [], folderEditPath: null, mode: 'empty' })
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
      else set({ assets: [], folderPaths: [], folderEditPath: null, mode: 'empty' })
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

    mode: 'empty',
    scanProgress: null,
    thumbNonce: 0,
    setAssets: (list) => set({ assets: list }),
    reloadActiveLibrary: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) {
        set({ assets: [], folderPaths: [], folderEditPath: null, mode: 'empty' })
        return
      }
      const libraryId = t.libraryId
      const request = ++reloadSeq
      void Promise.all([window.windowApi.assets.list(libraryId), window.windowApi.folders.list(libraryId)]).then(([r, folders]) => {
        if (request !== reloadSeq || get().tabs.find((x) => x.id === get().activeTabId)?.libraryId !== libraryId) return
        const data = r as { library?: unknown; assets?: Record<string, unknown>[]; indexes?: { id: number; name: string; path: string }[] }
        const assets = data.assets
        if (Array.isArray(assets)) {
          set((s) => {
            const folderPaths = 'paths' in folders ? folders.paths : []
            const activeFolder = s.nav.startsWith('folder:') ? s.nav.slice('folder:'.length) : null
            return {
              assets: assets.map(rowToAsset),
              indexes: (data.indexes as { id: number; name: string; path: string }[]) ?? [],
              folderPaths,
              folderEditPath: s.folderEditPath && folderPaths.includes(s.folderEditPath) ? s.folderEditPath : null,
              nav: activeFolder && !folderPaths.includes(activeFolder) ? 'all' : s.nav,
              mode: 'library'
            }
          })
        }
      })
    },
    bumpThumb: () => set((s) => ({ thumbNonce: s.thumbNonce + 1 })),
    folderPaths: [],
    folderEditPath: null,
    refreshFolders: () => {
      const t = get().tabs.find((x) => x.id === get().activeTabId)
      if (t?.libraryId == null) return
      void window.windowApi.folders.list(t.libraryId).then((r) => {
        if (!('paths' in r)) return
        set((s) => {
          const activeFolder = s.nav.startsWith('folder:') ? s.nav.slice('folder:'.length) : null
          return {
            folderPaths: r.paths,
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
        set((s) => ({
          folderPaths: [...new Set([...s.folderPaths, r.path])].sort((a, b) => a.localeCompare(b)),
          folderEditPath: r.path,
          nav: `folder:${r.path}` as NavKey
        }))
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
        set({ nav: folder ? `folder:${folder}` as NavKey : 'untagged' })
        get().reloadActiveLibrary()
      })
    },

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

    assets: [],
    indexes: [],
    setIndexes: (indexes) => set({ indexes }),
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
