import { describe, expect, it } from 'vitest'
import {
  assignTagToGroup,
  parseTagGroups,
  tagItemsForCategory,
  tagMenuItems,
  tagMenuItemsForView,
  visibleTagMenuItems
} from '../src/renderer/src/data/filter-menu'
import { DEFAULT_FILTERS, formatBytes } from '../src/renderer/src/data/query'
import type { Asset } from '../src/renderer/src/data/types'

const asset = (id: string, tags: Asset['tags'], patch: Partial<Asset> = {}): Asset => ({
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
  palette: [],
  ...patch
})

describe('tag filter menu', () => {
  it('reflects newly added tags, deduplicates them and counts usages', () => {
    const items = tagMenuItems([
      asset('a', [{ name: 'nature', color: '#3ECF8E' }]),
      asset('b', [{ name: 'nature', color: '#3ECF8E' }, { name: 'new-tag', color: '#F97316' }])
    ])
    expect(items).toEqual([
      { id: 'nature', label: 'nature', dotColor: '#3ECF8E', count: 2 },
      { id: 'new-tag', label: 'new-tag', dotColor: '#F97316', count: 1 }
    ])
  })

  it('assigns each tag to one custom group and resolves ungrouped tags', () => {
    const items = [
      { id: 'a', label: 'A', dotColor: '#1', count: 3 },
      { id: 'b', label: 'B', dotColor: '#2', count: 2 },
      { id: 'c', label: 'C', dotColor: '#3', count: 1 }
    ]
    const first = [
      { id: 'g1', name: '人物', tagNames: ['a'] },
      { id: 'g2', name: '场景', tagNames: [] }
    ]
    const assigned = assignTagToGroup(first, 'a', 'g2')
    expect(assigned.map((group) => group.tagNames)).toEqual([[], ['a']])
    expect(tagItemsForCategory(items, 'selected', assigned, ['a', 'c']).map((item) => item.id)).toEqual(['a', 'c'])
    expect(tagItemsForCategory(items, 'group:g2', assigned, []).map((item) => item.id)).toEqual(['a'])
    expect(tagItemsForCategory(items, 'ungrouped', assigned, []).map((item) => item.id)).toEqual(['b', 'c'])
    expect(visibleTagMenuItems(items, ' b ', 'name-asc').map((item) => item.id)).toEqual(['b'])
    expect(visibleTagMenuItems(items, '', 'count-asc').map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })

  it('parses only valid per-library category definitions', () => {
    expect(parseTagGroups({
      '1': [
        { id: 'g1', name: ' 人物 ', tagNames: ['克鲁鲁', '克鲁鲁', 42] },
        { id: 'g1', name: '重复 id', tagNames: [] },
        { id: 'g2', name: '人物', tagNames: [] },
        { id: '', name: '空 id', tagNames: [] }
      ],
      bad: [{ id: 'g3', name: '不合法库', tagNames: [] }],
      '2': 'oops'
    })).toEqual({
      '1': [{ id: 'g1', name: '人物', tagNames: ['克鲁鲁'] }]
    })
  })

  it('scopes candidates to the current folder and keeps the selected tag available', () => {
    const assets = [
      asset('a', [{ name: 'x', color: '#1' }, { name: 'y', color: '#2' }], { folders: ['表情包/林黛玉'] }),
      asset('b', [{ name: 'x', color: '#1' }], { folders: ['表情包/其他'] }),
      asset('c', [{ name: 'y', color: '#2' }, { name: 'z', color: '#3' }], { folders: ['表情包/林黛玉'] })
    ]
    const opts = {
      nav: 'folder:表情包/林黛玉' as const,
      search: '',
      filters: { ...DEFAULT_FILTERS, tags: ['y'] },
      stripColor: null
    }
    expect(tagMenuItemsForView(assets, opts)).toEqual([
      { id: 'y', label: 'y', dotColor: '#2', count: 2 },
      { id: 'x', label: 'x', dotColor: '#1', count: 1 },
      { id: 'z', label: 'z', dotColor: '#3', count: 1 }
    ])
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
