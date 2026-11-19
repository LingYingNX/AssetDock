import { describe, expect, it } from 'vitest'
import { formatCapability, formatFullDate, formatRelativeDate, formatResolution, infoRows, queryAssets, queryLightboxAssets, sidebarCounts, statsOf, type Filters } from '../src/renderer/src/data/query'
import type { Asset, NavKey } from '../src/renderer/src/data/types'
import { tagNavKey, tagsFromNav } from '../src/renderer/src/data/tag-nav'

const filters: Filters = { format: 'all', shape: 'all', size: 'all', rating: 'all', tags: [] }
const asset = (patch: Partial<Asset>): Asset => ({
  id: 'a', type: 'image', format: 'JPG', name: 'asset', sizeBytes: 1, importedAt: '2026-09-10T00:00', rating: 0,
  favorite: false, tags: [], folders: [], note: '', palette: [], ...patch
})
const query = (assets: Asset[], nav: NavKey = 'all', patch: Partial<Filters> = {}) => queryAssets(assets, { nav, search: '', filters: { ...filters, ...patch }, stripColor: null })

describe('queryAssets', () => {
  it('reuses the same result for the same asset snapshot and view', () => {
    const assets = [asset({ id: 'one', folders: ['图'] })]
    const opts = { nav: 'all' as const, search: '', filters, stripColor: null }
    expect(queryAssets(assets, opts)).toBe(queryAssets(assets, opts))
  })
  it('filters real folder paths and omits deleted or missing assets', () => {
    const assets = [asset({ id: 'one', folders: ['图', '图/壁纸'] }), asset({ id: 'two', folders: ['图'], missing: true }), asset({ id: 'three', folders: ['图'], deletedAt: '2026-09-10T00:00' })]
    expect(query(assets, 'folder:图').map((item) => item.id)).toEqual(['one'])
  })

  it('supports type, rating, tag and text filtering', () => {
    const assets = [asset({ id: 'photo', name: 'mountain', rating: 5, tags: [{ name: 'nature', color: '#3ECF8E' }] }), asset({ id: 'movie', type: 'video', format: 'MP4', name: 'river' })]
    expect(query(assets, 'all', { format: 'photo', rating: '5', tags: ['nature'] }).map((item) => item.id)).toEqual(['photo'])
    expect(queryAssets(assets, { nav: 'all', search: 'river', filters, stripColor: null }).map((item) => item.id)).toEqual(['movie'])
  })

  it('filters ratings from five stars down to one star', () => {
    const assets = [5, 4, 3, 2, 1, 0].map((rating) => asset({ id: String(rating), rating: rating as Asset['rating'] }))
    expect(query(assets, 'all', { rating: '5' }).map((item) => item.id)).toEqual(['5'])
    expect(query(assets, 'all', { rating: '4up' }).map((item) => item.id)).toEqual(['5', '4'])
    expect(query(assets, 'all', { rating: '3up' }).map((item) => item.id)).toEqual(['5', '4', '3'])
    expect(query(assets, 'all', { rating: '2up' }).map((item) => item.id)).toEqual(['5', '4', '3', '2'])
    expect(query(assets, 'all', { rating: '1up' }).map((item) => item.id)).toEqual(['5', '4', '3', '2', '1'])
  })

  it('matches any selected tag and keeps multi-tag navigation round-trippable', () => {
    const assets = [
      asset({ id: 'a', tags: [{ name: '人物', color: '#1' }] }),
      asset({ id: 'b', tags: [{ name: '场景', color: '#2' }] }),
      asset({ id: 'c', tags: [{ name: '道具', color: '#3' }] })
    ]
    const nav = tagNavKey(['人物', '场景'])
    expect(tagsFromNav(nav)).toEqual(['人物', '场景'])
    expect(query(assets, nav).map((item) => item.id)).toEqual(['a', 'b'])
    expect(query(assets, 'all', { tags: ['场景', '道具'] }).map((item) => item.id)).toEqual(['b', 'c'])
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

  it('keeps documents out of image shape and size semantics', () => {
    const doc = asset({ id: 'doc', type: 'document', format: 'DOCX', name: 'plan', pageCount: 3 })
    const photo = asset({ id: 'photo', width: 1920, height: 1080 })
    const assets = [doc, photo]

    expect(query(assets, 'all', { shape: 'square' }).map((x) => x.id)).toEqual([])
    expect(query(assets, 'all', { size: 'small' }).map((x) => x.id)).toEqual(['photo'])
    expect(query(assets, 'all', { shape: 'none' }).map((x) => x.id)).toEqual(['doc'])
    expect(query(assets, 'all', { size: 'none' }).map((x) => x.id)).toEqual(['doc'])
    expect(formatResolution(doc)).toBe('—')
    expect(formatCapability(doc)).toBe('内置只读预览')
    expect(infoRows(doc).map(([k]) => k)).toEqual(['类型', '能力', '页数', '大小', '导入', '来源'])
  })

  it('does not count documents under image dimensions', () => {
    const doc = asset({ id: 'doc', type: 'document', format: 'XLSX', name: 'book', sheetCount: 3 })
    expect(query([doc], 'all', { size: 'medium' })).toEqual([])
    expect(query([doc], 'all', { shape: 'pano' })).toEqual([])
  })

  it('labels built-in office documents separately from external converters', () => {
    expect(formatCapability(asset({ type: 'document', format: 'DOC' }))).toBe('内置只读预览')
    expect(formatCapability(asset({ type: 'document', format: 'PPT' }))).toBe('需外部办公软件转换')
    expect(formatCapability(asset({ type: 'document', format: 'XLSX', sheetCount: 3 }))).toBe('内置只读预览')
    expect(infoRows(asset({ type: 'document', format: 'XLS', sheetCount: 2 }))[2]).toEqual(['工作表', '2'])
    expect(infoRows(asset({ type: 'document', format: 'FODS', sheetCount: 4 }))[2]).toEqual(['工作表', '4'])
  })

  it('reports the real preview capability for external and transcoded formats', () => {
    expect(formatCapability(asset({ format: 'BLEND', type: 'model' }))).toBe('需 Blender')
    expect(formatCapability(asset({ format: 'C4D', type: 'model' }))).toBe('需 Cinema 4D')
    expect(formatCapability(asset({ format: 'MKV', type: 'video' }))).toBe('需转码播放')
    expect(formatCapability(asset({ format: 'EXR', type: 'image' }))).toBe('环境图预览')
    expect(formatCapability(asset({ format: 'AI', type: 'image' }))).toBe('PDF 兼容预览')
  })

  it('counts only live local assets in the sidebar', () => {
    const assets = [asset({ id: 'one', folders: ['图'], favorite: true }), asset({ id: 'two' }), asset({ id: 'trash', deletedAt: '2026-09-10T00:00' })]
    expect(sidebarCounts(assets)).toMatchObject({ all: 2, untagged: 1, fav: 1, trash: 1, folders: { 图: 1 } })
  })

  it('reports the count and total size for the current result set', () => {
    const assets = [asset({ id: 'one', sizeBytes: 1024 }), asset({ id: 'two', sizeBytes: 2048 })]
    expect(statsOf(query(assets))).toEqual({ count: 2, size: '3\u00A0KB' })
  })

  it('keeps lightbox navigation in the current view and falls back when needed', () => {
    const favorite = asset({ id: 'fav', favorite: true })
    const normal = asset({ id: 'normal' })
    const deleted = asset({ id: 'deleted', favorite: true, deletedAt: '2026-09-10T00:00' })
    const assets = [favorite, normal, deleted]
    const opts = { nav: 'fav' as const, search: '', filters, stripColor: null }

    expect(queryLightboxAssets(assets, opts, favorite.id).map((item) => item.id)).toEqual(['fav'])
    expect(queryLightboxAssets(assets, opts, normal.id).map((item) => item.id)).toEqual(['fav', 'normal'])
  })
})

describe('date formatting', () => {
  it('keeps today and yesterday relative to the supplied clock', () => {
    const now = new Date(2026, 10, 5, 12, 0)
    expect(formatRelativeDate(new Date(2026, 10, 5, 9, 7).toISOString(), now)).toBe('今天 09:07')
    expect(formatRelativeDate(new Date(2026, 10, 4, 23, 59).toISOString(), now)).toBe('昨天 23:59')
    expect(formatRelativeDate(new Date(2026, 10, 3, 8, 0).toISOString(), now)).toBe('11月3日')
  })

  it('formats the full timestamp through the locale formatter', () => {
    const formatted = formatFullDate(new Date(2026, 7, 30, 10, 24).toISOString())
    expect(formatted).toContain('2026')
    expect(formatted).toContain('10:24')
  })
})

describe('3D model filters', () => {
  it('keeps models out of pixel-size and shape filters', () => {
    const model = asset({ id: 'model', type: 'model', format: 'GLB', width: undefined, height: undefined })
    const photo = asset({ id: 'photo', width: 1280, height: 720 })
    const assets = [model, photo]

    expect(query(assets, 'all', { size: 'small' }).map((x) => x.id)).toEqual(['photo'])
    expect(query(assets, 'all', { size: 'large' }).map((x) => x.id)).toEqual([])
    expect(query(assets, 'all', { shape: 'landscape' }).map((x) => x.id)).toEqual(['photo'])
  })
})
