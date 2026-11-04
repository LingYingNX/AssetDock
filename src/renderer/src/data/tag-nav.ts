import type { NavKey } from './types'

const TAG_PREFIX = 'tag:'

/** 单个标签保持旧键格式;多个标签用 URL 编码的 JSON,避免拆分标签名。 */
export function tagNavKey(tags: readonly string[]): NavKey {
  const unique = [...new Set(tags.filter(Boolean))]
  if (unique.length === 0) return 'all'
  if (unique.length === 1) return `${TAG_PREFIX}${unique[0]}` as NavKey
  return `${TAG_PREFIX}${encodeURIComponent(JSON.stringify(unique))}` as NavKey
}

export function tagsFromNav(nav: NavKey): string[] {
  if (!nav.startsWith(TAG_PREFIX)) return []
  const raw = nav.slice(TAG_PREFIX.length)
  if (!raw) return []
  if (!raw.startsWith('%5B')) return [raw]
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0))]
  } catch {
    return []
  }
}
