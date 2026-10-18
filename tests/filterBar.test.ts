import { describe, expect, it } from 'vitest'
import { tagMenuItems } from '../src/renderer/src/data/filter-menu'
import type { Asset } from '../src/renderer/src/data/types'

const asset = (id: string, tags: Asset['tags']): Asset => ({
  id,
  type: 'image',
  format: 'JPG',
  name: id,
  sizeBytes: 1,
  importedAt: '2026-10-01T00:00',
  rating: 0,
  favorite: false,
  tags,
  folders: [],
  note: '',
  palette: []
})

describe('tag filter menu', () => {
  it('reflects newly added tags and deduplicates them', () => {
    const items = tagMenuItems([
      asset('a', [{ name: 'nature', color: '#3ECF8E' }]),
      asset('b', [{ name: 'nature', color: '#3ECF8E' }, { name: 'new-tag', color: '#F97316' }])
    ])
    expect(items.map((item) => item.id)).toEqual(['all', 'nature', 'new-tag'])
  })
})
