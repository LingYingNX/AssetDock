import type { Asset, NavKey } from './types'
import { formatSpec, needsVideoTranscode } from '../../../shared/formats'
import { tagsFromNav } from './tag-nav'

/* ---------- 展示格式化 ---------- */

export function formatBytes(bytes: number): string {
  const fmt = (n: number, unit: string): string =>
    `${n.toFixed(1).replace(/\.0$/, '')}\u00A0${unit}`
  if (bytes >= 1024 ** 3) return fmt(bytes / 1024 ** 3, 'GB')
  if (bytes >= 1024 ** 2) return fmt(bytes / 1024 ** 2, 'MB')
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}\u00A0KB`
  return `${bytes}\u00A0B`
}

/** 计数千分位:侧栏与筛选条共用,避免同屏出现「4,084」与「4084」两种口径。
    固定 en-US:只取千分位分隔,不随系统区域变化。 */
export function fmtCount(n: number): string {
  return n.toLocaleString('en-US')
}

const TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const MONTH_DAY_FORMAT = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' })
const FULL_DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
})

/** 相对日期:今天 HH:mm / 昨天 HH:mm / M月D日 */
export function formatRelativeDate(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((day(now) - day(d)) / 86_400_000)
  const hhmm = TIME_FORMAT.format(d)
  if (diffDays === 0) return `今天 ${hhmm}`
  if (diffDays === 1) return `昨天 ${hhmm}`
  return MONTH_DAY_FORMAT.format(d)
}

/** 完整时间:2026-08-30 10:24 */
export function formatFullDate(iso: string): string {
  return FULL_DATE_FORMAT.format(new Date(iso))
}

export function formatResolution(a: Asset): string {
  if (a.type === 'model') return ''
  if (a.type === 'document') return '—'
  if (a.format === 'SVG') return '矢量'
  if (!a.width || !a.height) return '—'
  return `${a.width}×${a.height}`
}

/* ---------- 颜色匹配(色相桶) ---------- */

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16) / 255
  const g = parseInt(m.slice(2, 4), 16) / 255
  const b = parseInt(m.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s, l }
}

/** 判断素材 palette 是否含有与目标色相近的颜色(色相差 ≤ 22°,低饱和按灰/黑处理) */
export function paletteHasColor(a: Asset, hex: string): boolean {
  const target = hexToHsl(hex)
  return a.palette.some((p) => {
    const c = hexToHsl(p.hex)
    if (target.s <= 0.14 || c.s <= 0.14) {
      return (c.s <= 0.14 && target.s <= 0.14 && Math.abs(c.l - target.l) < 0.3) ||
        (target.s > 0.14 && c.l < 0.25 && target.l < 0.2) ||
        (c.s > 0.14 && target.l < 0.2 && c.l < 0.25)
    }
    const dh = Math.min(Math.abs(c.h - target.h), 360 - Math.abs(c.h - target.h))
    return dh <= 22 && Math.abs(c.l - target.l) < 0.45
  })
}

/* ---------- 查询(签名对齐未来 SQLite 查询层) ---------- */

export interface Filters {
  format: string // 'all' | 'photo' | 'psd-ai' | 'svg-gif' | 'video' | 'glb' | 'fbx' | 'obj'
  shape: string // 'all' | 'landscape' | 'portrait' | 'square' | 'pano' | 'none'
  size: string // 'all' | 'small' | 'medium' | 'large' | 'none'
  rating: string // 'all' | '5' | '4up' | '3up' | '2up' | '1up' | 'none'
  tags: string[]
}

export const DEFAULT_FILTERS: Filters = {
  format: 'all',
  shape: 'all',
  size: 'all',
  rating: 'all',
  tags: []
}

export interface QueryOptions {
  nav: NavKey
  search: string
  filters: Filters
  /** 色带选中块(单选) */
  stripColor: string | null
}

const queryCache = new WeakMap<readonly Asset[], Map<string, Asset[]>>()
const QUERY_CACHE_MAX = 32

function queryCacheKey(opts: QueryOptions): string {
  return JSON.stringify([opts.nav, opts.search, opts.filters, opts.stripColor])
}

const RES_PX = (a: Asset): number => Math.max(a.width ?? 0, a.height ?? 0)

/** 「最近导入」阈值:7 天(S3-3,matchNav 与计数共用) */
export const RECENT_WINDOW_MS = 7 * 86_400_000

function matchNav(a: Asset, nav: NavKey): boolean {
  if (nav === 'trash') return !!a.deletedAt
  if (a.missing) return false
  if (a.deletedAt) return false
  switch (nav) {
    case 'all':
      return true
    case 'recent':
      return Date.now() - new Date(a.importedAt).getTime() < RECENT_WINDOW_MS
    case 'untagged':
      return a.folders.length === 0
    case 'fav':
      return a.favorite
    default:
      if (nav.startsWith('folder:')) {
        const f = nav.slice(7)
        return a.folders.includes(f)
      }
      if (nav.startsWith('tag:')) {
        const tags = tagsFromNav(nav)
        return tags.length > 0 && a.tags.some((x) => tags.includes(x.name))
      }
      return true
  }
}

function matchFilters(a: Asset, f: Filters): boolean {
  if (f.format !== 'all') {
    const fm = a.format
    // 旧持久化筛选值保留兼容；新值直接使用规范格式名。
    const legacy: Record<string, string[]> = {
      photo: ['JPG', 'PNG', 'WEBP'],
      'psd-ai': ['PSD'],
      'svg-gif': ['SVG', 'GIF'],
      video: ['MP4', 'MOV'],
      glb: ['GLB'],
      fbx: ['FBX'],
      obj: ['OBJ'],
      css: ['CSS']
    }
    if (!(legacy[f.format] ?? [f.format]).includes(fm)) return false
  }
  /* 形状只对位图/视频有意义:文档与三维模型没有宽高比,任何形状筛选下都不展示 */
  if (f.shape === 'none' && a.type !== 'document') return false
  if (f.shape !== 'all' && f.shape !== 'none' && (a.type === 'document' || a.type === 'model')) return false
  if (f.shape !== 'all' && f.shape !== 'none') {
    const ar = (a.width ?? 1) / (a.height ?? 1)
    if (f.shape === 'landscape' && !(ar > 1.2 && ar <= 2.2)) return false
    if (f.shape === 'portrait' && !(ar < 0.83)) return false
    if (f.shape === 'square' && !(ar >= 0.83 && ar <= 1.2)) return false
    if (f.shape === 'pano' && ar <= 2.2) return false
  }
  /* 尺寸同理:模型没有像素尺寸,不能同时落进「小」和「大」 */
  if (f.size === 'none' && a.type !== 'document') return false
  if (f.size !== 'all' && f.size !== 'none' && (a.type === 'document' || a.type === 'model')) return false
  if (f.size !== 'all' && f.size !== 'none') {
    const px = RES_PX(a)
    if (f.size === 'small' && px > 1920) return false
    if (f.size === 'medium' && !(px > 1920 && px < 3840)) return false
    if (f.size === 'large' && px < 3840) return false
  }
  if (f.rating !== 'all') {
    if (f.rating === '5' && a.rating !== 5) return false
    if (f.rating === '4up' && a.rating < 4) return false
    if (f.rating === '3up' && a.rating < 3) return false
    if (f.rating === '2up' && a.rating < 2) return false
    if (f.rating === '1up' && a.rating < 1) return false
    if (f.rating === 'none' && a.rating !== 0) return false
  }
  if (f.tags.length > 0 && !a.tags.some((x) => f.tags.includes(x.name))) return false
  return true
}

export function queryAssets(assets: readonly Asset[], opts: QueryOptions): Asset[] {
  const key = queryCacheKey(opts)
  let cached = queryCache.get(assets)
  if (!cached) queryCache.set(assets, cached = new Map())
  const hit = cached.get(key)
  if (hit) return hit
  const kw = opts.search.trim().toLowerCase()
  const matched = assets.filter((a) => {
    if (!matchNav(a, opts.nav)) return false
    if (!matchFilters(a, opts.filters)) return false
    if (opts.stripColor && !paletteHasColor(a, opts.stripColor)) return false
    if (kw) {
      const hay = [a.name, ...a.tags.map((t) => t.name), a.note, a.format].join(' ').toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
  cached.set(key, matched)
  while (cached.size > QUERY_CACHE_MAX) {
    const oldest = cached.keys().next().value
    if (oldest === undefined) break
    cached.delete(oldest)
  }
  return matched
}

/** 灯箱与胶片带共用的集合:当前视图命中时跟随筛选,否则回退到全库未删除素材。 */
export function queryLightboxAssets(
  assets: Asset[],
  opts: QueryOptions,
  lightboxId: string | null
): Asset[] {
  const scoped = queryAssets(assets, opts)
  return scoped.some((asset) => asset.id === lightboxId)
    ? scoped
    : assets.filter((asset) => !asset.deletedAt)
}

export interface SidebarCounts {
  all: number
  recent: number
  untagged: number
  fav: number
  trash: number
  folders: Record<string, number>
  tags: Record<string, number>
}

export function sidebarCounts(assets: Asset[]): SidebarCounts {
  const live = assets.filter((a) => !a.deletedAt && !a.missing)
  const c: SidebarCounts = {
    all: live.length,
    recent: 0,
    untagged: 0,
    fav: 0,
    trash: assets.filter((a) => !!a.deletedAt).length,
    folders: {},
    tags: {}
  }
  for (const a of live) {
    if (Date.now() - new Date(a.importedAt).getTime() < RECENT_WINDOW_MS) c.recent++
    if (a.folders.length === 0) c.untagged++
    if (a.favorite) c.fav++
    for (const f of a.folders) c.folders[f] = (c.folders[f] ?? 0) + 1
    for (const t of a.tags) c.tags[t.name] = (c.tags[t.name] ?? 0) + 1
  }
  return c
}

export function statsOf(list: Asset[]): { count: number; size: string } {
  const bytes = list.reduce((s, a) => s + a.sizeBytes, 0)
  return { count: list.length, size: formatBytes(bytes) }
}

/** 文件信息 dl:图片/视频与三维两套字段 */
export function infoRows(a: Asset): [string, string, string?][] {
  const capability = formatCapability(a)
  if (a.type === 'model') {
    return [
      ['类型', `${a.format} 模型`, a.format === 'GLB' ? 'glTF 2.0' : undefined],
      ['能力', capability],
      ['大小', formatBytes(a.sizeBytes)],
      ['导入', formatFullDate(a.importedAt)]
    ]
  }
  if (a.type === 'style') {
    return [
      ['类型', `${a.format} 样式表`],
      ['大小', formatBytes(a.sizeBytes)],
      ['导入', formatFullDate(a.importedAt)],
      ['来源', a.sourceUrl ? '外部链接' : '本地素材库']
    ]
  }
  if (a.type === 'document') {
    const structural: [string, string, string?][] = []
    const spec = formatSpec(a.format)
    const shape = spec && 'documentShape' in spec ? spec.documentShape : undefined
    if (shape === 'sheet') {
      structural.push(['工作表', a.sheetCount != null ? String(a.sheetCount) : '—'])
    } else if (shape === 'slides') {
      structural.push(['幻灯片', a.slideCount != null ? String(a.slideCount) : '—'])
    } else {
      structural.push(['页数', a.pageCount != null ? String(a.pageCount) : '—'])
    }
    return [
      ['类型', `${a.format} 文档`, a.textEncoding],
      ['能力', capability],
      ...structural,
      ['大小', formatBytes(a.sizeBytes)],
      ['导入', formatFullDate(a.importedAt)],
      ['来源', a.sourceUrl ? '外部链接' : '本地素材库']
    ]
  }
  const rows: [string, string, string?][] = [
    ['类型', `${a.format} ${a.type === 'video' ? '视频' : '图片'}`, a.type === 'video' ? codecLabel(a.codec) : undefined],
    ['能力', capability],
    ['分辨率', `${formatResolution(a)}`, a.format === 'SVG' ? undefined : pxLabel(a)]
  ]
  if (a.type === 'video') rows.push(['时长', `${a.duration ?? '—'}`, a.fps ? `${a.fps} fps` : undefined])
  rows.push(['大小', formatBytes(a.sizeBytes)])
  rows.push(['导入', formatFullDate(a.importedAt)])
  rows.push(['来源', a.sourceUrl ? '外部链接' : '本地素材库'])
  return rows
}

export function formatCapability(a: Asset): string {
  const spec = formatSpec(a.format)
  if (!spec) return '仅入库'
  if ('external' in spec && spec.external === 'blender') return '需 Blender'
  if ('external' in spec && spec.external === 'cinema4d') return '需 Cinema 4D'
  if (spec.type === 'document' && spec.preview === 'external') return '需外部办公软件转换'
  if (spec.type === 'document' && spec.preview === 'document') return '内置只读预览'
  if (spec.preview === 'envmap') return '环境图预览'
  if (spec.preview === 'pdf') return 'PDF 兼容预览'
  if (spec.preview === 'css') return '可编辑'
  if (spec.type === 'video') return needsVideoTranscode(a.format) ? '需转码播放' : '可播放'
  if (spec.preview === 'three' || spec.preview === 'image') return '可预览'
  return '仅入库'
}

/** 编码名展示映射 */
export function codecLabel(codec?: string): string | undefined {
  if (!codec) return undefined
  const map: Record<string, string> = {
    h264: 'H.264',
    hevc: 'HEVC',
    h265: 'HEVC',
    prores: 'ProRes',
    vp9: 'VP9',
    av1: 'AV1',
    mpeg4: 'MPEG-4',
    mjpeg: 'MJPEG'
  }
  return map[codec.toLowerCase()] ?? codec.toUpperCase()
}

/* ---------- 色带聚合:当前视图 palette 加权前 8 色 ---------- */

export function aggregatePalette(list: Asset[]): { hex: string; ratio: number }[] {
  type Bucket = { r: number; g: number; b: number; w: number }
  const buckets = new Map<number, Bucket>()
  for (const a of list) {
    for (const p of a.palette) {
      const m = p.hex.replace('#', '')
      if (m.length !== 6) continue
      const r = parseInt(m.slice(0, 2), 16)
      const g = parseInt(m.slice(2, 4), 16)
      const b = parseInt(m.slice(4, 6), 16)
      // 5bit/通道 量化分桶:16 级会把相近色全并成一格,色带老是那几块
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const bk = buckets.get(key) ?? { r: 0, g: 0, b: 0, w: 0 }
      bk.r += r * p.ratio
      bk.g += g * p.ratio
      bk.b += b * p.ratio
      bk.w += p.ratio
      buckets.set(key, bk)
    }
  }
  const total = [...buckets.values()].reduce((s, b) => s + b.w, 0)
  if (total === 0) return []
  const hex2 = (v: number): string => Math.round(v).toString(16).padStart(2, '0').toUpperCase()
  return [...buckets.values()]
    .sort((x, y) => y.w - x.w)
    .slice(0, 8)
    .map((b) => ({
      hex: `#${hex2(b.r / b.w)}${hex2(b.g / b.w)}${hex2(b.b / b.w)}`,
      ratio: Math.round((b.w / total) * 100)
    }))
}

function pxLabel(a: Asset): string | undefined {
  const px = RES_PX(a)
  if (px >= 7680) return '8K'
  if (px >= 3840) return '4K UHD'
  if (px >= 2560) return '2K'
  if (px >= 1920) return 'FHD'
  return undefined
}
