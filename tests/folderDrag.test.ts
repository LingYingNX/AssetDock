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
      paths: ['target', 'target/existing', 'target/source', 'target/source/child']
    })
  })

  it('rejects folder drops that would be invalid or target read-only folders', () => {
    expect(canDropFolder('source', 'source', 'inside', true)).toBe(false)
    expect(canDropFolder('source', 'source/child', 'inside', true)).toBe(false)
    expect(canDropFolder('source/child', 'source', 'inside', true)).toBe(false)
    expect(canDropFolder('source', 'eagle-folder', 'inside', false)).toBe(false)
  })
})
