import { describe, expect, it } from 'vitest'
import { tagMenuItems } from '../src/renderer/src/data/filter-menu'
import { formatBytes } from '../src/renderer/src/data/query'
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

describe('filter result size formatting', () => {
  it('keeps every size label within the widest slot form', () => {
    // 筛选条给大小留了固定槽:这些长度必须都不超过 `1023.9 MB` 的宽度(4.9em)
    expect([
      formatBytes(0),
      formatBytes(3 * 1024),
      formatBytes(131.1 * 1024 ** 2),
      formatBytes(1023.9 * 1024 ** 2),
      formatBytes(32.56 * 1024 ** 3)
    ]).toEqual(['0 B', '3 KB', '131.1 MB', '1023.9 MB', '32.6 GB'])
  })

})
