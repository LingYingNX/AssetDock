import { describe, expect, it } from 'vitest'
import { queryAssets, sidebarCounts, type Filters } from '../src/renderer/src/data/query'
import type { Asset, NavKey } from '../src/renderer/src/data/types'

const filters: Filters = { format: 'all', shape: 'all', size: 'all', rating: 'all', tag: 'all' }
const asset = (patch: Partial<Asset>): Asset => ({
  id: 'a', type: 'image', format: 'JPG', name: 'asset', sizeBytes: 1, importedAt: '2026-09-10T00:00', rating: 0,
  favorite: false, tags: [], folders: [], note: '', palette: [], ...patch
})
const query = (assets: Asset[], nav: NavKey = 'all', patch: Partial<Filters> = {}) => queryAssets(assets, { nav, search: '', filters: { ...filters, ...patch }, swatches: [], stripColor: null })

describe('queryAssets', () => {
  it('filters real folder paths and omits deleted or missing assets', () => {
    const assets = [asset({ id: 'one', folders: ['图', '图/壁纸'] }), asset({ id: 'two', folders: ['图'], missing: true }), asset({ id: 'three', folders: ['图'], deletedAt: '2026-09-10T00:00' })]
    expect(query(assets, 'folder:图').map((item) => item.id)).toEqual(['one'])
  })

  it('supports type, rating, tag and text filtering', () => {
    const assets = [asset({ id: 'photo', name: 'mountain', rating: 5, tags: [{ name: 'nature', color: '#3ECF8E' }] }), asset({ id: 'movie', type: 'video', format: 'MP4', name: 'river' })]
    expect(query(assets, 'all', { format: 'photo', rating: '5', tag: 'nature' }).map((item) => item.id)).toEqual(['photo'])
    expect(queryAssets(assets, { nav: 'all', search: 'river', filters, swatches: [], stripColor: null }).map((item) => item.id)).toEqual(['movie'])
  })

  it('counts only live local assets in the sidebar', () => {
    const assets = [asset({ id: 'one', folders: ['图'], favorite: true }), asset({ id: 'two' }), asset({ id: 'trash', deletedAt: '2026-09-10T00:00' })]
    expect(sidebarCounts(assets)).toMatchObject({ all: 2, untagged: 1, fav: 1, trash: 1, folders: { 图: 1 } })
  })
})
