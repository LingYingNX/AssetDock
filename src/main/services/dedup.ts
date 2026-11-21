import sharp from 'sharp'
import type { DedupRule } from '../../shared/types'

/**
 * 相似图片去重。
 *
 * dHash(9x8 灰度相邻像素比较,64 位)对「同一张图的不同压缩/缩放」稳定,
 * 对内容不同的图敏感;再配宽高比与位数守恒门槛挡住纯色/近纯色图的假相似。
 * 哈希随素材记录持久化在 assets.phash 列(`${fingerprint}:${hex}:${色块签名}`),
 * 指纹变了(文件被改过)前缀就对不上,下次扫描自然重算。
 */

/** 每种规则的汉明距离上限(64 位内) */
export const DEDUP_MAX_DISTANCE: Record<DedupRule, number> = {
  strict: 4,
  balanced: 8,
  loose: 12
}

/** 宽高比容差:比例差超过 4% 视为不同构图,不参与配对 */
export const ASPECT_TOLERANCE = 0.04
/** 哈希中置位少于该值视为近纯色图(噪声低、不同图也会撞哈希),不参与配对 */
export const MIN_SET_BITS = 2
/** 体积比超过该倍数不配对:静态缩略图与几十倍体积的动图常是「首帧撞车」 */
export const MAX_SIZE_RATIO = 100

export interface DedupInputRow {
  id: number
  relPath: string
  name: string
  format?: string
  width: number | null
  height: number | null
  sizeBytes: number
  fingerprint: string
  color?: string
  phash: string | null
}

export interface DedupKeyed {
  id: number
  relPath: string
  name: string
  format?: string
  width: number | null
  height: number | null
  sizeBytes: number
  fingerprint: string
  hash: string
  color?: string
}

/**
 * 计算 dHash。返回 16 位 hex(64 位);解码失败返回 null。
 * rotate() 先套用 EXIF 方向,缩略图与比对共用同一套几何。
 */
export async function dHashHex(absPath: string): Promise<string | null> {
  try {
    const { data } = await sharp(absPath, { failOn: 'none' })
      .rotate()
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let bits = ''
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        bits += data[row * 9 + col] > data[row * 9 + col + 1] ? '1' : '0'
      }
    }
    return BigInt(`0b${bits}`).toString(16).padStart(16, '0')
  } catch {
    return null
  }
}

/** 已存哈希形如 `${fingerprint}:${hex}`;拆出指纹前缀与哈希本体 */
export function splitStoredHash(phash: string | null): { fp: string | null; hash: string | null; color: string | null } {
  if (!phash) return { fp: null, hash: null, color: null }
  const at = phash.indexOf(':')
  if (at <= 0 || at === phash.length - 1) return { fp: null, hash: null, color: null }
  const rest = phash.slice(at + 1)
  const sep = rest.indexOf(':')
  if (sep < 0) return { fp: phash.slice(0, at), hash: rest, color: null }
  return { fp: phash.slice(0, at), hash: rest.slice(0, sep), color: rest.slice(sep + 1) }
}

/** 两个 hex 哈希的汉明距离(要求等长) */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x > 0) {
      distance += x & 1
      x >>= 1
    }
  }
  return distance
}

function setBits(hex: string): number {
  return [...hex].reduce((total, ch) => total + popcount(parseInt(ch, 16)), 0)
}

function popcount(x: number): number {
  let count = 0
  while (x > 0) {
    count += x & 1
    x >>= 1
  }
  return count
}

function aspectRatio(row: Pick<DedupKeyed, 'width' | 'height'>): number | null {
  if (!row.width || !row.height) return null
  return row.width / row.height
}

/**
 * 按汉明距离把素材聚成相似组(并查集)。
 * 三道门:置位守恒、宽高比接近、距离不超上限——少一道就会把不同内容拉进同一组。
 */
export function groupSimilar(items: DedupKeyed[], rule: DedupRule): DedupKeyed[][] {
  const maxDistance = DEDUP_MAX_DISTANCE[rule]
  const parent = items.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (i: number, j: number): void => {
    parent[find(i)] = find(j)
  }
  for (let i = 0; i < items.length; i++) {
    const a = items[i]
    if (setBits(a.hash) < MIN_SET_BITS) continue
    const ar = aspectRatio(a)
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j]
      if (setBits(b.hash) < MIN_SET_BITS) continue
      if (hammingDistance(a.hash, b.hash) > maxDistance) continue
      if (isAnimatedGif(a) !== isAnimatedGif(b) || sizeRatioExceeded(a, b)) continue
      if (rule === 'strict' && a.color !== b.color) continue
      const br = aspectRatio(b)
      if (ar != null && br != null && Math.abs(ar - br) / Math.max(ar, br) > ASPECT_TOLERANCE) continue
      union(i, j)
    }
  }
  const groups = new Map<number, DedupKeyed[]>()
  for (let i = 0; i < items.length; i++) {
    const root = find(i)
    const list = groups.get(root)
    if (list) list.push(items[i])
    else groups.set(root, [items[i]])
  }
  return [...groups.values()].filter((g) => g.length > 1)
}

/**
 * 组内排序:推荐保留项排最前。
 * 先比像素数(清晰度),再比体积,最后按入库顺序兜底,保证结果稳定。
 */
export function sortByQuality(items: DedupKeyed[]): DedupKeyed[] {
  return [...items].sort((a, b) => {
    const pixels = (r: DedupKeyed): number => (r.width && r.height ? r.width * r.height : 0)
    return pixels(b) - pixels(a) || b.sizeBytes - a.sizeBytes || a.id - b.id
  })
}

/** 左侧选中文件夹转库内相对路径;空值或含 .. 的路径回落整库 */
export function normalizeFolder(folder?: string | null): string {
  if (typeof folder !== 'string') return ''
  const clean = folder.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '')
  if (!clean || clean.split('/').some((part) => part === '..')) return ''
  return clean
}

/** GIF 只和 GIF 配:静态图与动图首帧常撞哈希,但不是重复素材 */
function isAnimatedGif(row: DedupKeyed): boolean {
  return (row.format ?? '').toUpperCase() === 'GIF'
}

function sizeRatioExceeded(a: DedupKeyed, b: DedupKeyed): boolean {
  const small = Math.min(a.sizeBytes, b.sizeBytes)
  return small <= 0 || Math.max(a.sizeBytes, b.sizeBytes) / small > MAX_SIZE_RATIO
}
/**
 * 4x4 色块签名:每格 5 位——亮于整体均值、红>绿、绿>蓝。
 * 同内容的压缩/缩放副本色结构稳定;色块不同的两张图在严格档直接否决。
 */
export function colorSignature(rgb: Buffer): string {
  let bits = ''
  let sum = 0
  for (let i = 0; i < rgb.length; i += 3) sum += (rgb[i] + rgb[i + 1] + rgb[i + 2]) / 3
  const mean = sum / (rgb.length / 3)
  for (let p = 0; p < rgb.length; p += 3) {
    const r = rgb[p]
    const g = rgb[p + 1]
    const b = rgb[p + 2]
    bits += (r + g + b) / 3 > mean ? '1' : '0'
    bits += r > g ? '1' : '0'
    bits += g > b ? '1' : '0'
  }
  return BigInt(`0b${bits}`).toString(16).padStart(20, '0')
}

/** dHash 与色块签名一次解码取齐,供首次扫描写入缓存 */
export async function dHashColor(absPath: string): Promise<{ hash: string; color: string } | null> {
  try {
    const { data } = await sharp(absPath, { failOn: 'none' })
      .rotate()
      .resize(9, 8, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let bits = ''
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        bits += data[row * 9 + col] > data[row * 9 + col + 1] ? '1' : '0'
      }
    }
    const { data: rgb } = await sharp(absPath, { failOn: 'none' })
      .rotate()
      .resize(4, 4, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    return { hash: BigInt(`0b${bits}`).toString(16).padStart(16, '0'), color: colorSignature(rgb) }
  } catch {
    return null
  }
}