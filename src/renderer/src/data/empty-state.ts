import type { Filters } from './query'
import type { NavKey } from './types'

export type EmptyKind = 'results' | 'library' | 'trash'
export type EmptyAction = 'clearFilters' | 'newLibrary' | 'backAll' | null

export interface EmptyStateInput {
  mode: 'empty' | 'library' | 'error'
  nav: NavKey
  search: string
  filters: Filters
  stripColor: string | null
}

export interface EmptyStateCopy {
  kind: EmptyKind
  title: string
  action: EmptyAction
}

export function emptyStateFor(input: EmptyStateInput): EmptyStateCopy {
  if (input.nav === 'trash') {
    return { kind: 'trash', title: '回收站是空的', action: 'backAll' }
  }
  if (input.mode === 'empty') {
    return { kind: 'library', title: '还没有素材库', action: 'newLibrary' }
  }
  const filtered =
    input.search.trim() !== '' ||
    input.stripColor != null ||
    input.filters.tags.length > 0 ||
    input.filters.format !== 'all' ||
    input.filters.shape !== 'all' ||
    input.filters.size !== 'all' ||
    input.filters.rating !== 'all'
  if (filtered) {
    return { kind: 'results', title: '没有符合当前筛选条件的素材', action: 'clearFilters' }
  }
  return {
    kind: 'library',
    title: '这个视图下没有素材',
    action: input.nav === 'all' ? null : 'backAll'
  }
}
