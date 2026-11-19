import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLibDb } from '../src/main/services/libraryDb'
import { deleteFolderTree, listFolderStyles, renameFolderStyles, setFolderStyles } from '../src/main/services/store'

describe('folder styles', () => {
  let root = ''
  let db: ReturnType<typeof openLibDb>
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mediahub-folder-styles-'))
    db = openLibDb(root)
  })
  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('stores icon and color per path and merges partial updates', () => {
    setFolderStyles(db, 1, ['图/壁纸'], { icon: 'image', color: '#22D3EE' })
    setFolderStyles(db, 1, ['图/壁纸'], { color: '#F97316' })
    expect(listFolderStyles(db, 1)).toEqual([{ path: '图/壁纸', icon: 'image', color: '#F97316' }])
  })

  it('applies one style to a batch and resets rows when both fields clear', () => {
    setFolderStyles(db, 1, ['a', 'b'], { icon: 'star', color: '#A855F7' })
    expect(listFolderStyles(db, 1)).toHaveLength(2)
    setFolderStyles(db, 1, ['a', 'b'], { icon: null, color: null })
    expect(listFolderStyles(db, 1)).toEqual([])
  })

  it('keeps libraries isolated', () => {
    setFolderStyles(db, 1, ['a'], { icon: 'book', color: '#3B82F6' })
    expect(listFolderStyles(db, 2)).toEqual([])
  })

  it('moves styles with the folder path on rename and drops them with the tree', () => {
    setFolderStyles(db, 1, ['图', '图/壁纸'], { icon: 'star', color: '#A855F7' })
    renameFolderStyles(db, 1, '图', '图片')
    expect(listFolderStyles(db, 1)).toEqual([
      { path: '图片', icon: 'star', color: '#A855F7' },
      { path: '图片/壁纸', icon: 'star', color: '#A855F7' }
    ])
    deleteFolderTree(db, 1, '图片')
    expect(listFolderStyles(db, 1)).toEqual([])
  })
})