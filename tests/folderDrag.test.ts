import { describe, expect, it } from 'vitest'
import { canDropFolder, folderDropClass, folderDropPlacement, optimisticFolderMove } from '../src/renderer/src/data/folder-drag'

describe('folder drag', () => {
  it('maps the upper, middle, and lower portions of a row to distinct placements', () => {
    expect(folderDropPlacement(0, 29)).toBe('before')
    expect(folderDropPlacement(14, 29)).toBe('inside')
    expect(folderDropPlacement(28, 29)).toBe('after')
  })

  it('maps each placement to its immediate row indicator class', () => {
    expect(folderDropClass('before')).toBe('folder-drop-before')
    expect(folderDropClass('inside')).toBe('folder-drop-inside')
    expect(folderDropClass('after')).toBe('folder-drop-after')
  })

  it('rebases the moved subtree and inserts it after the target subtree', () => {
    expect(optimisticFolderMove(
      ['source', 'source/child', 'target', 'target/existing'],
      'source',
      'target',
      'inside'
    )).toEqual({
      path: 'target/source',
      paths: ['target', 'target/existing', 'target/source', 'target/source/child'],
      conflict: false
    })
  })

  it('rejects folder drops that would be invalid or target read-only folders', () => {
    expect(canDropFolder('source', 'source', 'inside', true)).toBe(false)
    expect(canDropFolder('source', 'source/child', 'inside', true)).toBe(false)
    expect(canDropFolder('source/child', 'source', 'inside', true)).toBe(false)
    expect(canDropFolder('source', 'eagle-folder', 'inside', false)).toBe(false)
  })

  it('allows moving a folder with children onto a sibling folder child', () => {
    expect(canDropFolder('source', 'other/child', 'after', true)).toBe(true)
    expect(canDropFolder('source', 'other/child', 'inside', true)).toBe(true)
  })

  it('moves a nested folder to the library root and appends it after root siblings', () => {
    expect(canDropFolder('parent/child', '', 'inside', true)).toBe(true)
    expect(canDropFolder('root-folder', '', 'inside', true)).toBe(false)
    expect(optimisticFolderMove(
      ['root-a', 'root-b', 'parent', 'parent/child', 'parent/child/grandchild'],
      'parent/child',
      '',
      'inside'
    )).toEqual({
      path: 'child',
      paths: ['root-a', 'root-b', 'parent', 'child', 'child/grandchild'],
      conflict: false
    })
  })

  it('never fabricates a duplicate path when the target already has a same-named child', () => {
    const moved = optimisticFolderMove(
      ['source', 'source/child', 'target', 'target/existing', 'target/source'],
      'source',
      'target',
      'inside'
    )
    expect(moved.paths).toEqual(['source', 'source/child', 'target', 'target/existing', 'target/source'])
    expect(moved.conflict).toBe(true)
    expect(new Set(moved.paths).size).toBe(moved.paths.length)
  })

  it('never fabricates a duplicate path when only a descendant collides', () => {
    const moved = optimisticFolderMove(
      ['source', 'source/child', 'target', 'target/source/child'],
      'source',
      'target',
      'inside'
    )
    expect(moved.paths).toEqual(['source', 'source/child', 'target', 'target/source/child'])
    expect(moved.conflict).toBe(true)
    expect(new Set(moved.paths).size).toBe(moved.paths.length)
  })
})
