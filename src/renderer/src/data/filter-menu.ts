import type { Asset } from './types'
import { queryAssets, type QueryOptions } from './query'
import { FORMAT_GROUPS } from '../../../shared/formats'

export interface TagMenuItem {
  id: string
  label: string
  dotColor: string
  count: number
}

export interface TagGroupDefinition {
  id: string
  name: string
  tagNames: string[]
}

export type TagCategory = 'all' | 'selected' | 'ungrouped' | `group:${string}`
export type TagSort = 'count-desc' | 'count-asc' | 'name-asc'

/** 标签筛选项只由当前素材集合决定，新增标签后无需等待其它界面状态刷新。 */
export function tagMenuItems(assets: readonly Asset[]): TagMenuItem[] {
  const seen = new Map<string, TagMenuItem>()
  for (const asset of assets) {
    for (const tag of asset.tags) {
      const item = seen.get(tag.name)
      if (item) item.count++
      else seen.set(tag.name, { id: tag.name, label: tag.name, dotColor: tag.color, count: 1 })
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
}

/** 标签候选跟随当前视图,但不被当前标签筛选反向收窄。 */
export function tagMenuItemsForView(assets: readonly Asset[], opts: QueryOptions): TagMenuItem[] {
  return tagMenuItems(queryAssets(assets, {
    ...opts,
    filters: { ...opts.filters, tags: [] }
  }))
}

export interface FormatMenuGroup {
  type: string
  label: string
  formats: readonly string[]
  open: boolean
}

/**
 * 格式下拉的分组只保留当前视图真实存在的格式;空分类整组不出现。
 * 已选格式即使本文件夹没有也要保留,否则菜单里找不到当前选中项。
 */
export function formatMenuGroups(
  available: ReadonlySet<string>,
  selected: string,
  collapsed: readonly string[]
): FormatMenuGroup[] {
  const groups: FormatMenuGroup[] = []
  for (const group of FORMAT_GROUPS) {
    const formats = group.formats.filter((format) => available.has(format) || format === selected)
    if (formats.length === 0) continue
    groups.push({
      type: group.type,
      label: group.label,
      formats,
      open: !collapsed.includes(group.type)
    })
  }
  return groups
}

/** uiPrefs 中的分类表只收数字库 id;坏条目逐项丢弃,不阻断其它库的分类。 */
export function parseTagGroups(value: unknown): Record<string, TagGroupDefinition[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, TagGroupDefinition[]> = {}
  for (const [libraryId, rawGroups] of Object.entries(value)) {
    if (!/^\d+$/.test(libraryId) || !Array.isArray(rawGroups)) continue
    const ids = new Set<string>()
    const names = new Set<string>()
    const groups: TagGroupDefinition[] = []
    for (const raw of rawGroups) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Partial<TagGroupDefinition>
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!id || id.length > 100 || !name || name.length > 24) continue
      const nameKey = name.toLocaleLowerCase()
      if (ids.has(id) || names.has(nameKey)) continue
      const tagNames = Array.isArray(item.tagNames)
        ? [...new Set(item.tagNames.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0 && tag.length <= 200))]
        : []
      ids.add(id)
      names.add(nameKey)
      groups.push({ id, name, tagNames })
    }
    if (groups.length > 0) out[libraryId] = groups
  }
  return out
}

/** 一个标签只属于一个自定义总分类;拖到新分类时先从旧分类摘除。 */
export function assignTagToGroup(
  groups: readonly TagGroupDefinition[],
  tagName: string,
  targetGroupId: string | null
): TagGroupDefinition[] {
  const next = groups.map((group) => ({
    ...group,
    tagNames: group.tagNames.filter((name) => name !== tagName)
  }))
  if (targetGroupId == null) return next
  return next.map((group) =>
    group.id === targetGroupId && !group.tagNames.includes(tagName)
      ? { ...group, tagNames: [...group.tagNames, tagName] }
      : group
  )
}

export function tagItemsForCategory(
  items: readonly TagMenuItem[],
  category: TagCategory,
  groups: readonly TagGroupDefinition[],
  selected: readonly string[]
): TagMenuItem[] {
  if (category === 'all') return [...items]
  if (category === 'selected') return items.filter((item) => selected.includes(item.id))
  if (category === 'ungrouped') {
    const grouped = new Set(groups.flatMap((group) => group.tagNames))
    return items.filter((item) => !grouped.has(item.id))
  }
  const group = groups.find((item) => category === `group:${item.id}`)
  if (!group) return []
  const members = new Set(group.tagNames)
  return items.filter((item) => members.has(item.id))
}

export function visibleTagMenuItems(
  items: readonly TagMenuItem[],
  query: string,
  sort: TagSort
): TagMenuItem[] {
  const q = query.trim().toLowerCase()
  const visible = q ? items.filter((item) => item.label.toLowerCase().includes(q)) : [...items]
  if (sort === 'count-asc') return visible.sort((a, b) => a.count - b.count || a.label.localeCompare(b.label, 'zh-CN'))
  if (sort === 'name-asc') return visible.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  return visible.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
}
