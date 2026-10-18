import type { Asset } from './types'

export interface TagMenuItem {
  id: string
  label: string
  groupEnd?: boolean
  dotColor?: string
}

/** 标签筛选项只由当前素材集合决定，新增标签后无需等待其它界面状态刷新。 */
export function tagMenuItems(assets: readonly Asset[]): TagMenuItem[] {
  const seen = new Map<string, string>()
  for (const asset of assets) {
    for (const tag of asset.tags) seen.set(tag.name, tag.color)
  }
  return [
    { id: 'all', label: '全部标签', groupEnd: true },
    ...[...seen.entries()].map(([name, color]) => ({ id: name, label: name, dotColor: color }))
  ]
}
