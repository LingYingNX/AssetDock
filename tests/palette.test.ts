import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { extractPalette, extractPaletteFromImage, refreshPalettes } from '../src/main/services/palette'
import { openMemoryDb } from '../src/main/services/db'

function raw(w: number, h: number, rgb: [number, number, number]): Buffer {
  const buf = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = rgb[0]
    buf[i * 3 + 1] = rgb[1]
    buf[i * 3 + 2] = rgb[2]
  }
  return buf
}

describe('k-means palette (worker_threads)', () => {
  it('纯色图 → 单色 100%', async () => {
    const p = await extractPalette(raw(64, 64, [30, 120, 220]), 64, 64)
    expect(p).toHaveLength(1)
    expect(p[0].ratio).toBe(100)
    expect(p[0].hex).toBe('#1E78DC')
  })

  it('双色图 → 两主色,占比约半', async () => {
    const w = 64, h = 64
    const buf = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        const c = x < 32 ? [255, 0, 0] : [0, 0, 255]
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]
      }
    }
    const p = await extractPalette(buf, w, h)
    expect(p.length).toBe(2)
    const red = p.find((c) => c.hex === '#FF0000')
    const blue = p.find((c) => c.hex === '#0000FF')
    expect(red && blue).toBeTruthy()
    expect(Math.abs((red?.ratio ?? 0) - 50)).toBeLessThanOrEqual(5)
  })
})

describe('extractPaletteFromImage (原文件)', () => {
  let root = ''
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mediahub-palette-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('纯红 JPEG → 主色红主导,占比合计约 100%', async () => {
    const file = join(root, 'red.jpg')
    await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toFile(file)
    const p = await extractPaletteFromImage(file)
    expect(p.length).toBeGreaterThan(0)
    for (const c of p) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/)
    const sum = p.reduce((acc, c) => acc + c.ratio, 0)
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(3)
    const top = p[0]
    const r = parseInt(top.hex.slice(1, 3), 16)
    const g = parseInt(top.hex.slice(3, 5), 16)
    const b = parseInt(top.hex.slice(5, 7), 16)
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('非图片文件 → 静默降级为空 palette', async () => {
    const file = join(root, 'fake.jpg')
    await writeFile(file, 'this is not an image')
    await expect(extractPaletteFromImage(file)).resolves.toEqual([])
  })
})

describe('refreshPalettes (回填)', () => {
  let root = ''
  let db: ReturnType<typeof openMemoryDb>
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mediahub-palette-'))
    db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'Library', root)
  })
  afterEach(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  const insertAsset = (relPath: string, missing = 0): number =>
    Number(db.prepare(
      "INSERT INTO assets(library_id, rel_path, name, type, format, size_bytes, mtime_ms, fingerprint, imported_at, palette, missing) VALUES (1, ?, ?, 'image', 'JPG', 8, 1, ?, '2026-09-19T00:00', '[]', ?)"
    ).run(relPath, relPath, relPath, missing).lastInsertRowid)

  it('只为在场文件补 palette,缺失行跳过', async () => {
    await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 255 } } }).jpeg().toFile(join(root, 'blue.jpg'))
    const presentId = insertAsset('blue.jpg')
    const missingId = insertAsset('gone.jpg', 1)

    const count = await refreshPalettes(db, 1, root)

    expect(count).toBe(1)
    const present = db.prepare('SELECT palette FROM assets WHERE id = ?').get(presentId) as { palette: string }
    const missing = db.prepare('SELECT palette FROM assets WHERE id = ?').get(missingId) as { palette: string }
    expect(JSON.parse(present.palette).length).toBeGreaterThan(0)
    expect(missing.palette).toBe('[]')
  })

  it('指定 assetIds 时无条件重抽', async () => {
    await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 0, g: 0, b: 255 } } }).jpeg().toFile(join(root, 'blue.jpg'))
    const id = insertAsset('blue.jpg')
    db.prepare("UPDATE assets SET palette = '[{\"hex\":\"#123456\",\"ratio\":100}]' WHERE id = ?").run(id)

    const count = await refreshPalettes(db, 1, root, { assetIds: [id] })

    expect(count).toBe(1)
    const row = db.prepare('SELECT palette FROM assets WHERE id = ?').get(id) as { palette: string }
    expect(row.palette).not.toContain('123456')
  })
})
