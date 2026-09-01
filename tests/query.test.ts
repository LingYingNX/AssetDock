import { describe, it, expect } from 'vitest'
import { queryAssets, DEFAULT_FILTERS } from '../src/renderer/src/data/query'
import type { Asset } from '../src/renderer/src/data/types'

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
    expect(queryAssets(withMissing, { ...base(), nav: 'recent' }).map((a) => a.id)).toEqual(['1', '2'])
  })
})

function base() {
  return { nav: 'all' as const, search: '', filters: DEFAULT_FILTERS, swatches: [] as string[], stripColor: null }
}
