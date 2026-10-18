import { describe, expect, it } from 'vitest'
import { emptyStateFor } from '../src/renderer/src/data/empty-state'
import { DEFAULT_FILTERS } from '../src/renderer/src/data/query'

describe('empty state copy', () => {
  it('offers to clear filters when a search or filter has no matches', () => {
    expect(emptyStateFor({
      mode: 'library',
      nav: 'all',
      search: 'missing',
      filters: DEFAULT_FILTERS,
      stripColor: null
    })).toMatchObject({ kind: 'results', action: 'clearFilters' })
  })

  it('offers back to all for an empty trash or folder', () => {
    expect(emptyStateFor({
      mode: 'library',
      nav: 'trash',
      search: '',
      filters: DEFAULT_FILTERS,
      stripColor: null
    })).toMatchObject({ kind: 'trash', action: 'backAll' })
    expect(emptyStateFor({
      mode: 'library',
      nav: 'folder:empty',
      search: '',
      filters: DEFAULT_FILTERS,
      stripColor: null
    })).toMatchObject({ kind: 'library', action: 'backAll' })
  })

  it('offers to create a library when no library is bound', () => {
    expect(emptyStateFor({
      mode: 'empty',
      nav: 'all',
      search: '',
      filters: DEFAULT_FILTERS,
      stripColor: null
    })).toMatchObject({ kind: 'library', action: 'newLibrary' })
  })
})
