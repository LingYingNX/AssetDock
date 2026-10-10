import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { openMemoryDb } from '../src/main/services/db'
import { closeAllLibHandles, ensureLibraryStorage, openLibDb } from '../src/main/services/libraryDb'
import { upsertScanned, setAssetMissing, createLibrary, listLibraries, listAssets, type ScanEntry } from '../src/main/services/store'
import type { LibraryRow } from '../src/shared/types'

let root: string
let libPath: string
let memDb: ReturnType<typeof openMemoryDb>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mediahub-reconcile-'))
  libPath = join(root, 'lib')
  mkdirSync(libPath, { recursive: true })
})

afterEach(() => {
  closeAllLibHandles()
  memDb?.close()
  try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* Windows 句柄滞后 */ }
})

function seed(): ReturnType<typeof openLibDb> {
  memDb = openMemoryDb()
  ensureLibraryStorage(memDb, { id: 1, name: '对账库', path: libPath })
  return openLibDb(libPath)
}

function entry(relPath: string): ScanEntry {
  return {
    relPath,
    name: relPath.slice(relPath.lastIndexOf('/') + 1, relPath.lastIndexOf('.')),
    type: 'image',
    format: 'jpg',
    sizeBytes: 100,
    mtimeMs: 1700000000000,
    fingerprint: `fp-${relPath}`
  }
}

describe('S2-7 库清空对账语义', () => {
  it('空 entries 也应让存量资产走 missing 标记(reconcileRoot 的 missing 循环与 upsert 解耦)', () => {
    const db = seed()
    const [first] = upsertScanned(db, 1, [entry('a/a.jpg')])
    expect(first.action).toBe('added')

    // 库被清空:对账拿到空 entries,upsert 分支跳过,但 missing 对账循环仍要执行
    const known = db.prepare('SELECT id, rel_path FROM assets WHERE library_id = ? AND missing = 0').all(1) as { id: number; rel_path: string }[]
    const onDisk = new Set<string>()
    let marked = 0
    for (const k of known) {
      if (onDisk.has(k.rel_path)) continue
      if (setAssetMissing(db, 1, k.rel_path, true)) marked++
    }
    expect(marked).toBe(1)
    expect((db.prepare('SELECT missing FROM assets WHERE id = ?').get(first.assetId) as { missing: number }).missing).toBe(1)
  })

  it('重新出现后 missing 复位为 0', () => {
    const db = seed()
    const [a] = upsertScanned(db, 1, [entry('a/a.jpg')])
    setAssetMissing(db, 1, 'a/a.jpg', true)
    // 尺寸/指纹变化模拟重新出现的不同文件实例;updateScanned 带 missing = 0 复位
    const reappeared = { ...entry('a/a.jpg'), sizeBytes: 999, mtimeMs: 1700000009000, fingerprint: 'fp-re' }
    const [again] = upsertScanned(db, 1, [reappeared])
    expect(again.assetId).toBe(a.assetId)
    expect(again.action).toBe('changed')
    expect((db.prepare('SELECT missing FROM assets WHERE id = ?').get(a.assetId) as { missing: number }).missing).toBe(0)
  })
})

describe('S2-4 unchanged 跳过写入', () => {
  it('unchanged 条目不触发 UPDATE(imported_at 不被触碰,零写入放大)', () => {
    const db = seed()
    const [first] = upsertScanned(db, 1, [entry('x/y.png')])
    const importedAt = (db.prepare('SELECT imported_at FROM assets WHERE id = ?').get(first.assetId) as { imported_at: string }).imported_at
    const before = (db.pragma('data_version') as { data_version: number }[])[0].data_version
    const [second] = upsertScanned(db, 1, [entry('x/y.png')])
    const after = (db.pragma('data_version') as { data_version: number }[])[0].data_version
    expect(second.action).toBe('unchanged')
    expect(after).toBe(before) // 没有任何写入,data_version 不变
    expect((db.prepare('SELECT imported_at FROM assets WHERE id = ?').get(first.assetId) as { imported_at: string }).imported_at).toBe(importedAt)
  })

  it('changed 条目仍然正常写回', () => {
    const db = seed()
    const [first] = upsertScanned(db, 1, [entry('x/y.png')])
    const changed = { ...entry('x/y.png'), sizeBytes: 200, fingerprint: 'fp-2', mtimeMs: 1700000001000 }
    const [second] = upsertScanned(db, 1, [changed])
    expect(second.action).toBe('changed')
    expect((db.prepare('SELECT size_bytes FROM assets WHERE id = ?').get(first.assetId) as { size_bytes: number }).size_bytes).toBe(200)
  })
})

describe('S2-5 createLibrary 查重收敛 store 层', () => {
  it('大小写不同但等价的路径被拒绝(Windows 语义)', () => {
    const db = seed()
    memDb.prepare('INSERT INTO libraries(id, name, path) VALUES (9, ?, ?)').run('另一个库', libPath)
    const r = createLibrary(memDb, '测试', libPath.toUpperCase())
    expect(r).toEqual({ error: '该目录已绑定为素材库' })
  })

  it('不同路径正常创建', () => {
    const db = seed()
    const r = createLibrary(memDb, '新库', join(root, 'other'))
    expect(r).toHaveProperty('id')
  })
})

describe('S2-3 批量标签与 S2-6 毫秒时间戳', () => {
  it('listAssets 标签与逐行查询等价(含无标签行为 0 个)', () => {
    const db = seed()
    const [a1] = upsertScanned(db, 1, [entry('t/1.jpg'), entry('t/2.jpg')])
    // per-lib schema 的 tags 表在这里独立,直接插
    db.prepare('INSERT INTO tags(id, name, color) VALUES (1, ?, ?)').run('场景', '#22D3EE')
    db.prepare('INSERT INTO asset_tags(asset_id, tag_id) VALUES (?, 1)').run(a1.assetId)
    const rows = listAssets(db, 1)
    expect(rows.length).toBe(2)
    const withTag = rows.find((r) => r.id === a1.assetId)!
    const without = rows.find((r) => r.id !== a1.assetId)!
    expect(withTag.tags).toEqual([{ name: '场景', color: '#22D3EE' }])
    expect(without.tags).toEqual([])
  })

  it('imported_at 保留毫秒精度(ISO 完整格式)', () => {
    const db = seed()
    const [first] = upsertScanned(db, 1, [entry('m/1.jpg')])
    const importedAt = (db.prepare('SELECT imported_at FROM assets WHERE id = ?').get(first.assetId) as { imported_at: string }).imported_at
    expect(importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(() => new Date(importedAt).toISOString()).not.toThrow()
  })
})
