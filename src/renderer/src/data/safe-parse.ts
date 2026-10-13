import type { PaletteColor } from './types'

/**
 * 素材行里 palette 字段的安全解析。
 *
 * 该字段在库里是 JSON 文本(TEXT DEFAULT '[]'),写入方分散在扫描、监听与主色补齐三处,
 * 而读取只有 rowToAsset 一个入口。历史库、手工改库或写入中断都可能留下非法 JSON、
 * 空串、null 或合法 JSON 但非数组的内容 —— 原来直接 JSON.parse 会抛错,而这个抛错
 * 发生在 assets.map(rowToAsset) 里,于是「一条坏记录」会让整批素材一起加载失败。
 *
 * 这里把失败面收窄到单条记录的单个字段:四种坏输入都降级为空数组,不向外抛错,
 * 同批其它记录不受影响。
 */
export function parsePalette(raw: unknown): PaletteColor[] {
  if (Array.isArray(raw)) return normalize(raw)
  if (typeof raw !== 'string') return []
  const text = raw.trim()
  if (text === '') return []
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? normalize(parsed) : []
  } catch {
    return []
  }
}

/** 只收形如 { hex, ratio } 的项;ratio 缺失或非有限数按 0 计 */
function normalize(list: unknown[]): PaletteColor[] {
  const out: PaletteColor[] = []
  for (const item of list) {
    if (item == null || typeof item !== 'object') continue
    const c = item as { hex?: unknown; ratio?: unknown }
    if (typeof c.hex !== 'string' || c.hex === '') continue
    out.push({
      hex: c.hex,
      ratio: typeof c.ratio === 'number' && Number.isFinite(c.ratio) ? c.ratio : 0
    })
  }
  return out
}
