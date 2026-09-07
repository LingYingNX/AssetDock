import { describe, it, expect } from 'vitest'
import { queryAssets, DEFAULT_FILTERS, sidebarCounts } from '../src/renderer/src/data/query'
import type { Asset, NavKey } from '../src/renderer/src/data/types'

function asset(partial: Partial<Asset>): Asset {
  return {
    id: partial.id ?? 'x',
    type: 'image',
    format: 'JPG',
    name: 'n',
    sizeBytes: 1000,
    importedAt: '2026-08-31T10:00',
    rating: 0,
    favorite: false,
    tags: [],
    folders: [],
    note: '',
    palette: [],
    ...partial
  }
}

const list: Asset[] = [
  asset({ id: '1', name: '咖啡产品图', width: 6000, height: 4000, rating: 5, tags: [{ name: '产品图', color: '#22D3EE' }], palette: [{ hex: '#F0527C', ratio: 50 }, { hex: '#FFE3B3', ratio: 50 }] }),
  asset({ id: '2', name: 'Logo', format: 'PNG', width: 2400, height: 2400, rating: 3, favorite: true }),
  asset({ id: '3', type: 'video', format: 'MP4', name: '演示', width: 3840, height: 2160, duration: '00:32', deletedAt: '2026-08-31T11:00' })
]

describe('queryAssets semantics (Change 1 锁定)', () => {
  it('trash 隔离:deleted 只在 trash 出现', () => {
    expect(queryAssets(list, { ...base(), nav: 'all' }).map((a) => a.id)).toEqual(['1', '2'])
    expect(queryAssets(list, { ...base(), nav: 'trash' }).map((a) => a.id)).toEqual(['3'])
  })
  it('rating 过滤', () => {
    const r = { ...base(), filters: { ...DEFAULT_FILTERS, rating: '5' } }
    expect(queryAssets(list, r).map((a) => a.id)).toEqual(['1'])
  })
  it('tag 过滤', () => {
    const r = { ...base(), filters: { ...DEFAULT_FILTERS, tag: '产品图' } }
    expect(queryAssets(list, r).map((a) => a.id)).toEqual(['1'])
  })
  it('搜索命中名称', () => {
    expect(queryAssets(list, { ...base(), search: '咖啡' }).map((a) => a.id)).toEqual(['1'])
  })
  it('颜色筛选命中 palette 色系', () => {
    expect(queryAssets(list, { ...base(), swatches: ['#EF4444'] }).map((a) => a.id)).toEqual(['1'])
  })
  it('缺失文件不出现在任何默认视图(仅回收站看 deleted)', () => {
    const withMissing: Asset[] = [asset({ id: '4', missing: true }), ...list]
    expect(queryAssets(withMissing, { ...base(), nav: 'all' }).map((a) => a.id)).toEqual(['1', '2'])
    const recent = list.map((a) => ({ ...a, importedAt: new Date(Date.now() - 86_400_000).toISOString() }))
    expect(queryAssets([asset({ id: '4', missing: true }), ...recent], { ...base(), nav: 'recent' }).map((a) => a.id)).toEqual(['1', '2'])
  })

  it('索引来源及其目录可单独筛选', () => {
    const indexed = [
      asset({ id: '4', sourceIndexId: 7, relPath: '@index:7/root.jpg' }),
      asset({ id: '5', sourceIndexId: 7, relPath: '@index:7/reference/a.jpg' }),
      asset({ id: '6', sourceIndexId: 8, relPath: '@index:8/reference/b.jpg' })
    ]
    expect(queryAssets(indexed, { ...base(), nav: 'index:7' as NavKey }).map((a) => a.id)).toEqual(['4', '5'])
    expect(queryAssets(indexed, { ...base(), nav: 'index-folder:7:reference' as NavKey }).map((a) => a.id)).toEqual(['5'])
  })

  it('侧栏计数不把缺失素材误算为可浏览素材', () => {
    const counts = sidebarCounts([
      asset({ id: '1' }),
      asset({ id: '2', missing: true }),
      asset({ id: '3', deletedAt: '2026-08-31T11:00' })
    ])
    expect(counts).toMatchObject({ all: 1, untagged: 1, trash: 1 })
  })

  it('未分类按文件夹判断,已有目录的素材不再计入', () => {
    expect(sidebarCounts([asset({ id: 'root' }), asset({ id: 'foldered', folders: ['人物'] })]).untagged).toBe(1)
    expect(queryAssets([asset({ id: 'foldered', folders: ['人物'] })], { ...base(), nav: 'untagged' })).toEqual([])
  })
})

function base() {
  return { nav: 'all' as const, search: '', filters: DEFAULT_FILTERS, swatches: [] as string[], stripColor: null }
}
