import { ASSETS, COLOR_STRIP, FOLDERS, SWATCHES } from './dataset'
import type { Asset, NavKey } from './types'

/* ---------- 展示格式化 ---------- */

export function formatBytes(bytes: number): string {
  const fmt = (n: number, unit: string): string =>
    `${n.toFixed(1).replace(/\.0$/, '')} ${unit}`
  if (bytes >= 1024 ** 3) return fmt(bytes / 1024 ** 3, 'GB')
  if (bytes >= 1024 ** 2) return fmt(bytes / 1024 ** 2, 'MB')
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function formatFaces(n: number): string {
  return n.toLocaleString('en-US')
}

/** 相对日期:今天 HH:mm / 昨天 HH:mm / M月D日 */
export function formatRelativeDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((day(now) - day(d)) / 86_400_000)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (diffDays <= 0) return `今天 ${hhmm}`
  if (diffDays === 1) return `昨天 ${hhmm}`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 完整时间:2026-08-30 10:24 */
export function formatFullDate(iso: string): string {
  return iso.replace('T', ' ')
}

export function formatResolution(a: Asset): string {
  if (a.type === 'model') return ''
  if (a.format === 'SVG') return '矢量'
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
  shape: string // 'all' | 'landscape' | 'portrait' | 'square' | 'pano'
  size: string // 'all' | 'small' | 'medium' | 'large'
  rating: string // 'all' | '5' | '4up' | '3up' | 'none'
  tag: string // 'all' | 标签名
}

export const DEFAULT_FILTERS: Filters = {
  format: 'all',
  shape: 'all',
  size: 'all',
  rating: 'all',
  tag: 'all'
}

export interface QueryOptions {
  nav: NavKey
  search: string
  filters: Filters
  /** 侧栏颜色圆点(多选) */
  swatches: string[]
  /** 色带选中块(单选) */
  stripColor: string | null
}

const RES_PX = (a: Asset): number => Math.max(a.width ?? 0, a.height ?? 0)

function matchNav(a: Asset, nav: NavKey): boolean {
  if (nav === 'trash') return !!a.deletedAt
  if (a.deletedAt) return false
  switch (nav) {
    case 'all':
      return true
    case 'recent':
      return Date.now() - new Date(a.importedAt).getTime() < 7 * 86_400_000
    case 'untagged':
      return a.tags.length === 0
    case 'fav':
      return a.favorite
    default:
      if (nav.startsWith('folder:')) {
        const f = nav.slice(7)
        return a.folders.includes(f)
      }
      if (nav.startsWith('tag:')) {
        const tg = nav.slice(4)
        return a.tags.some((x) => x.name === tg)
      }
      return true
  }
}

function matchFilters(a: Asset, f: Filters): boolean {
  if (f.format !== 'all') {
    const fm = a.format
    if (f.format === 'photo' && !['JPG', 'PNG', 'WEBP'].includes(fm)) return false
    if (f.format === 'psd-ai' && fm !== 'PSD') return false
    if (f.format === 'svg-gif' && !['SVG', 'GIF'].includes(fm)) return false
    if (f.format === 'video' && !['MP4', 'MOV'].includes(fm)) return false
    if (f.format === 'glb' && fm !== 'GLB') return false
    if (f.format === 'fbx' && fm !== 'FBX') return false
    if (f.format === 'obj' && fm !== 'OBJ') return false
  }
  if (f.shape !== 'all' && a.type !== 'model') {
    const ar = (a.width ?? 1) / (a.height ?? 1)
    if (f.shape === 'landscape' && !(ar > 1.2 && ar <= 2.2)) return false
    if (f.shape === 'portrait' && !(ar < 0.83)) return false
    if (f.shape === 'square' && !(ar >= 0.83 && ar <= 1.2)) return false
    if (f.shape === 'pano' && ar <= 2.2) return false
  }
  if (f.size !== 'all') {
    const px = RES_PX(a)
    if (f.size === 'small' && px > 1920) return false
    if (f.size === 'medium' && !(px > 1920 && px < 3840)) return false
    if (f.size === 'large' && px < 3840 && a.type !== 'model') return false
  }
  if (f.rating !== 'all') {
    if (f.rating === '5' && a.rating !== 5) return false
    if (f.rating === '4up' && a.rating < 4) return false
    if (f.rating === '3up' && a.rating < 3) return false
    if (f.rating === 'none' && a.rating !== 0) return false
  }
  if (f.tag !== 'all' && !a.tags.some((x) => x.name === f.tag)) return false
  return true
}

export function queryAssets(assets: Asset[], opts: QueryOptions): Asset[] {
  const kw = opts.search.trim().toLowerCase()
  return assets.filter((a) => {
    if (!matchNav(a, opts.nav)) return false
    if (!matchFilters(a, opts.filters)) return false
    if (opts.swatches.length > 0 && !opts.swatches.some((c) => paletteHasColor(a, c))) return false
    if (opts.stripColor && !paletteHasColor(a, opts.stripColor)) return false
    if (kw) {
      const hay = [a.name, ...a.tags.map((t) => t.name), a.note, a.format].join(' ').toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
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
  const live = assets.filter((a) => !a.deletedAt)
  const c: SidebarCounts = {
    all: live.length,
    recent: 0,
    untagged: 0,
    fav: 0,
    trash: assets.length - live.length,
    folders: {},
    tags: {}
  }
  for (const a of live) {
    if (Date.now() - new Date(a.importedAt).getTime() < 7 * 86_400_000) c.recent++
    if (a.tags.length === 0) c.untagged++
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
  if (a.type === 'model') {
    return [
      ['类型', `${a.format} 模型`, a.format === 'GLB' ? 'glTF 2.0' : undefined],
      ['面数', formatFaces(a.faceCount ?? 0), '三角面'],
      ['顶点', formatFaces(a.vertices ?? 0)],
      ['材质', a.materialInfo ?? '—'],
      ['大小', formatBytes(a.sizeBytes)],
      ['导入', formatFullDate(a.importedAt)]
    ]
  }
  const rows: [string, string, string?][] = [
    ['类型', `${a.format} ${a.type === 'video' ? '视频' : '图片'}`],
    ['分辨率', `${formatResolution(a)}`, a.format === 'SVG' ? undefined : pxLabel(a)]
  ]
  if (a.type === 'video') rows.push(['时长', `${a.duration ?? '—'}`])
  rows.push(['大小', formatBytes(a.sizeBytes)])
  rows.push(['导入', formatFullDate(a.importedAt)])
  rows.push(['来源', a.sourceUrl ? '外部链接' : '本地导入'])
  return rows
}

function pxLabel(a: Asset): string | undefined {
  const px = RES_PX(a)
  if (px >= 7680) return '8K'
  if (px >= 3840) return '4K UHD'
  if (px >= 2560) return '2K'
  if (px >= 1920) return 'FHD'
  return undefined
}

export { ASSETS, FOLDERS, SWATCHES, COLOR_STRIP }
