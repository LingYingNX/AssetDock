import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  openLibDb,
  hasLibDb,
  getLibHandle,
  releaseLibHandle,
  hasLibHandle,
  cachedHandleCount,
  closeAllLibHandles,
  libDbPath,
  mediaDir
} from '../src/main/services/libraryDb'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mediahub-libdb-'))
})

afterEach(() => {
  closeAllLibHandles()
  rmSync(root, { recursive: true, force: true })
})

describe('迁移幂等', () => {
  it('重复 openLibDb 不重复加列(schema 用 IF NOT EXISTS + 列存在性检查)', () => {
    mkdirSync(mediaDir(root), { recursive: true })
    expect(hasLibDb(root)).toBe(false)
    const db1 = openLibDb(root)
    db1.close()
    expect(hasLibDb(root)).toBe(true)
    const db2 = openLibDb(root)
    const cols = db2.pragma('table_info(assets)') as { name: string }[]
    const names = cols.map((c) => c.name)
    expect(names.filter((n) => n === 'folder_path').length).toBe(1)
    expect(names.filter((n) => n === 'eagle_mtime_ms').length).toBe(1)
    expect(names.filter((n) => n === 'manual_order').length).toBe(1)
    db2.close()
  })

  it('libDbPath 指向 .mediahub/library.db 且 openLibDb 会创建目录', () => {
    expect(libDbPath(root)).toBe(join(root, '.mediahub', 'library.db'))
    const db = openLibDb(root)
    expect(existsSync(libDbPath(root))).toBe(true)
    db.close()
  })

  it('半成品 tmp 文件不影响正常打开', () => {
    mkdirSync(mediaDir(root), { recursive: true })
    writeFileSync(libDbPath(root) + '.tmp-999', 'garbage')
    const db = openLibDb(root)
    expect(db.prepare('SELECT COUNT(*) AS c FROM assets').get()).toEqual({ c: 0 })
    db.close()
  })
})

describe('句柄 LRU + 引用计数', () => {
  it('getLibHandle 缓存命中返回同一实例', () => {
    const a = getLibHandle(root)
    const b = getLibHandle(root)
    expect(a).toBe(b)
    expect(cachedHandleCount()).toBe(1)
    releaseLibHandle(root)
    releaseLibHandle(root)
  })

  it('引用计数未归零的句柄不被驱逐;归零后可再次获取', () => {
    const a = getLibHandle(root)
    expect(a.open).toBe(true)
    // 模拟 LRU 压力:占满缓存
    const other = mkdtempSync(join(tmpdir(), 'mediahub-libdb-b-'))
    try {
      for (let i = 0; i < 70; i++) {
        const p = join(other, 'lib' + i)
        mkdirSync(p, { recursive: true })
        getLibHandle(p)
        releaseLibHandle(p)
      }
      // root 的计数仍为 1,句柄必须存活
      expect(hasLibHandle(root)).toBe(true)
      expect(a.open).toBe(true)
    } finally {
      // Windows 上 db 文件被句柄锁定,先关全部缓存句柄再删临时目录
      closeAllLibHandles()
      rmSync(other, { recursive: true, force: true })
    }
    releaseLibHandle(root)
    // 归零后可重新获取(可能被驱逐后重开,实例可能不同,但必须可用)
    const c = getLibHandle(root)
    expect(c.open).toBe(true)
    releaseLibHandle(root)
  })

  it('release 多余次数不会把计数打成负数', () => {
    getLibHandle(root)
    releaseLibHandle(root)
    releaseLibHandle(root)
    releaseLibHandle(root)
    // 再取仍正常
    const d = getLibHandle(root)
    expect(d.open).toBe(true)
    releaseLibHandle(root)
  })

  it('closeAllLibHandles 清空缓存与计数', () => {
    getLibHandle(root)
    closeAllLibHandles()
    expect(cachedHandleCount()).toBe(0)
    expect(hasLibHandle(root)).toBe(false)
  })
})
