import { create } from 'zustand'
import type { Asset, LibraryTab, NavKey } from '../data/types'
import { ASSETS, TAGS } from '../data/dataset'
import { DEFAULT_FILTERS, type Filters } from '../data/query'

export type ViewMode = 'waterfall' | 'grid' | 'list'

export interface CtxMenuState {
  x: number
  y: number
  assetId: string
}

interface UIState {
  /* 标题栏库标签页 */
  tabs: LibraryTab[]
  activeTabId: string
  openTab: (id: string) => void
  closeTab: (id: string) => void
  addTab: () => void

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

  /* 素材数据(可变字段走 store,保证界面联动) */
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

export const useUI = create<UIState>((set, get) => ({
  tabs: initialTabs,
  activeTabId: initialTabs[0].id,
  openTab: (id) => set({ activeTabId: id }),
  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    const rest = tabs.filter((t) => t.id !== id)
    if (rest.length === 0) return
    const nextActive =
      id === activeTabId ? (rest[Math.max(0, idx - 1)] ?? rest[0]).id : activeTabId
    set({ tabs: rest, activeTabId: nextActive })
  },
  addTab: () => {
    tabSeq++
    const tab = { id: `lib-new-${tabSeq}`, name: '新建素材库' }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
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
      swatches: s.swatches.includes(color)
        ? s.swatches.filter((c) => c !== color)
        : [...s.swatches, color]
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
    set((s) => ({
      assets: s.assets.map((a) =>
        a.id === id ? { ...a, rating: Math.min(5, Math.max(0, v)) as Asset['rating'] } : a
      )
    })),
  toggleFavorite: (id) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, favorite: !a.favorite } : a))
    })),
  toggleReviewFlag: (id) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, reviewFlag: !a.reviewFlag } : a))
    })),
  renameAsset: (id, name) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, name } : a)),
      renaming: false
    })),
  addTag: (id, name) =>
    set((s) => ({
      assets: s.assets.map((a) =>
        a.id === id && !a.tags.some((t) => t.name === name)
          ? { ...a, tags: [...a.tags, { name, color: TAG_COLOR(name) }] }
          : a
      )
    })),
  removeTag: (id, name) =>
    set((s) => ({
      assets: s.assets.map((a) =>
        a.id === id ? { ...a, tags: a.tags.filter((t) => t.name !== name) } : a
      )
    })),
  setNote: (id, note) =>
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, note } : a)) })),
  setSourceUrl: (id, sourceUrl) =>
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, sourceUrl } : a)) })),
  trashAsset: (id) =>
    set((s) => ({
      assets: s.assets.map((a) =>
        a.id === id ? { ...a, deletedAt: new Date().toISOString() } : a
      ),
      selectedIds: s.selectedIds.filter((x) => x !== id),
      activeId: s.activeId === id ? null : s.activeId,
      lightboxId: s.lightboxId === id ? null : s.lightboxId,
      ctxMenu: null
    })),

  selectedIds: [],
  activeId: null,
  focusedCardId: null,
  clickCard: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
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
}))

function TAG_COLOR(name: string): string {
  return TAGS[name] ?? '#64748B'
}
