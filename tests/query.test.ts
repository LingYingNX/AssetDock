import { describe, expect, it } from 'vitest'
import { formatResolution, infoRows, queryAssets, sidebarCounts, statsOf, type Filters } from '../src/renderer/src/data/query'
import type { Asset, NavKey } from '../src/renderer/src/data/types'

const filters: Filters = { format: 'all', shape: 'all', size: 'all', rating: 'all', tag: 'all' }
const asset = (patch: Partial<Asset>): Asset => ({
  id: 'a', type: 'image', format: 'JPG', name: 'asset', sizeBytes: 1, importedAt: '2026-09-10T00:00', rating: 0,
  favorite: false, tags: [], folders: [], note: '', palette: [], ...patch
})
const query = (assets: Asset[], nav: NavKey = 'all', patch: Partial<Filters> = {}) => queryAssets(assets, { nav, search: '', filters: { ...filters, ...patch }, stripColor: null })

describe('queryAssets', () => {
  it('filters real folder paths and omits deleted or missing assets', () => {
    const assets = [asset({ id: 'one', folders: ['图', '图/壁纸'] }), asset({ id: 'two', folders: ['图'], missing: true }), asset({ id: 'three', folders: ['图'], deletedAt: '2026-09-10T00:00' })]
    expect(query(assets, 'folder:图').map((item) => item.id)).toEqual(['one'])
  })

  it('supports type, rating, tag and text filtering', () => {
    const assets = [asset({ id: 'photo', name: 'mountain', rating: 5, tags: [{ name: 'nature', color: '#3ECF8E' }] }), asset({ id: 'movie', type: 'video', format: 'MP4', name: 'river' })]
    expect(query(assets, 'all', { format: 'photo', rating: '5', tag: 'nature' }).map((item) => item.id)).toEqual(['photo'])
    expect(queryAssets(assets, { nav: 'all', search: 'river', filters, stripColor: null }).map((item) => item.id)).toEqual(['movie'])
  })

  it('treats css as its own format without shape/size misfires', () => {
    const css = asset({ id: 'css', type: 'style', format: 'CSS', name: 'loader', width: undefined, height: undefined })
    const photo = asset({ id: 'photo', width: 1920, height: 1080 })
    const assets = [css, photo]

    expect(query(assets, 'all', { format: 'css' }).map((x) => x.id)).toEqual(['css'])
    expect(query(assets, 'all', { format: 'photo' }).map((x) => x.id)).toEqual(['photo'])
    // CSS 没有尺寸:沿用无尺寸素材的既有语义(ar 按 1:1、像素按 0 参与),
    // 因此在「方形」与「小图」筛选中被纳入,在「全景」与「大图」筛选中被排除
    expect(query(assets, 'all', { shape: 'square' }).map((x) => x.id)).toEqual(['css'])
    expect(query(assets, 'all', { shape: 'landscape' }).map((x) => x.id)).toEqual(['photo'])
    expect(query(assets, 'all', { shape: 'pano' }).map((x) => x.id)).toEqual([])
    expect(query(assets, 'all', { size: 'small' }).map((x) => x.id)).toEqual(['css', 'photo'])
    expect(query(assets, 'all', { size: 'large' }).map((x) => x.id)).toEqual([])
  })

  it('reports css file info without resolution or duration', () => {
    const css = asset({ id: 'css', type: 'style', format: 'CSS', name: 'loader', sourceUrl: 'media://1/loader.css' })
    const rows = infoRows(css)
    expect(rows.map(([k]) => k)).toEqual(['类型', '大小', '导入', '来源'])
    expect(rows[0][1]).toContain('CSS')
  })

  it('uses a placeholder for images without dimensions', () => {
    expect(formatResolution(asset({ format: 'PSD', width: undefined, height: undefined }))).toBe('—')
  })
  it('counts only live local assets in the sidebar', () => {
    const assets = [asset({ id: 'one', folders: ['图'], favorite: true }), asset({ id: 'two' }), asset({ id: 'trash', deletedAt: '2026-09-10T00:00' })]
    expect(sidebarCounts(assets)).toMatchObject({ all: 2, untagged: 1, fav: 1, trash: 1, folders: { 图: 1 } })
  })

  it('reports the count and total size for the current result set', () => {
    const assets = [asset({ id: 'one', sizeBytes: 1024 }), asset({ id: 'two', sizeBytes: 2048 })]
    expect(statsOf(query(assets))).toEqual({ count: 2, size: '3 KB' })
  })
})
