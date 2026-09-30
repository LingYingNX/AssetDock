import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 用假渲染器替换离屏截图:测试只关心「CSS 走渲染分支」与失败回退,不依赖真实 Electron
const renderCalls: string[] = []
let shouldFail = false
vi.mock('../src/main/services/cssThumb', () => ({
  renderCssThumbFromFile: async (_libPath: string, absPath: string) => {
    renderCalls.push(absPath)
    if (shouldFail) throw new Error('renderer unavailable')
    const sharp = (await import('sharp')).default
    return sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .jpeg()
      .toBuffer()
  }
}))

import { SHELL_VERSION, ensureThumb, flushManifest, resetThumbCache, thumbPath } from '../src/main/services/thumbs'

describe('css thumbnail branch', () => {
  let root = ''
  beforeEach(async () => {
    resetThumbCache()
    renderCalls.length = 0
    shouldFail = false
    root = await mkdtemp(join(tmpdir(), 'mediahub-css-thumb-'))
  })
  afterEach(async () => {
    resetThumbCache()
    await rm(root, { recursive: true, force: true })
  })

  const writeCss = async (name = 'loader.css'): Promise<string> => {
    const abs = join(root, name)
    await writeFile(abs, '.loader{color:seagreen}')
    return abs
  }

  it('routes CSS through the offscreen renderer instead of sharp', async () => {
    const absCss = await writeCss()
    const result = await ensureThumb(root, absCss, 'fp-css-branch', 'CSS', { relPath: 'loader.css', mtimeMs: 1, sizeBytes: 20 })

    expect(renderCalls).toEqual([absCss])
    expect(result.placeholder).toBe(false)
    expect(result.path).toBe(thumbPath(root, 'fp-css-branch'))
    expect(await access(result.path).then(() => true, () => false)).toBe(true)

    const meta = await (await import('sharp')).default(await readFile(result.path)).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('falls back to a CSS placeholder when the renderer fails', async () => {
    shouldFail = true
    const absCss = await writeCss()
    const result = await ensureThumb(root, absCss, 'fp-css-fail', 'CSS', { relPath: 'loader.css', mtimeMs: 1, sizeBytes: 20 })

    expect(renderCalls).toEqual([absCss])
    expect(result.placeholder).toBe(true)
    const meta = await (await import('sharp')).default(await readFile(result.path)).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('does not touch the renderer for non-css formats', async () => {
    const sharp = (await import('sharp')).default
    const absPng = join(root, 'photo.png')
    await writeFile(absPng, await sharp({ create: { width: 60, height: 40, channels: 3, background: { r: 10, g: 160, b: 60 } } }).png().toBuffer())
    await ensureThumb(root, absPng, 'fp-png-branch', 'PNG', { relPath: 'photo.png', mtimeMs: 1, sizeBytes: 10 })
    expect(renderCalls).toEqual([])
  })

  it('re-renders a css cover whose stored shell version is stale', async () => {
    const absCss = await writeCss()
    const meta = { relPath: 'loader.css', mtimeMs: 1, sizeBytes: 20 }
    await ensureThumb(root, absCss, 'fp-css-stale', 'CSS', meta)
    expect(renderCalls.length).toBe(1)
    await flushManifest(root)

    // 手工把清单里的骨架版本改成旧值:模拟「渲染逻辑已升级,素材本身没变」
    const manifestPath = join(root, '.mediahub', 'thumbs', 'index.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.entries['fp-css-stale'].shell = 1
    await writeFile(manifestPath, JSON.stringify(manifest))
    resetThumbCache()

    await ensureThumb(root, absCss, 'fp-css-stale', 'CSS', meta, 'look-a')
    expect(renderCalls.length).toBe(2)
    await flushManifest(root)
    const after = JSON.parse(await readFile(manifestPath, 'utf8'))
    expect(after.entries['fp-css-stale'].shell).toBe(SHELL_VERSION)
    expect(after.entries['fp-css-stale'].look).toBe('look-a')
  })

  it('keeps an up-to-date css cover untouched', async () => {
    const absCss = await writeCss('keep.css')
    const meta = { relPath: 'keep.css', mtimeMs: 1, sizeBytes: 20 }
    await ensureThumb(root, absCss, 'fp-css-keep', 'CSS', meta, 'look-a')
    expect(renderCalls.length).toBe(1)

    // 指纹与外观都没变:不重画
    await ensureThumb(root, absCss, 'fp-css-keep', 'CSS', meta, 'look-a')
    expect(renderCalls.length).toBe(1)
  })

  it('re-renders when the sibling html changes but the css fingerprint does not', async () => {
    const absCss = await writeCss('look.css')
    const meta = { relPath: 'look.css', mtimeMs: 1, sizeBytes: 20 }
    await ensureThumb(root, absCss, 'fp-css-look', 'CSS', meta, 'look-a')
    expect(renderCalls.length).toBe(1)

    // 配套 HTML 改了 → 外观签名变,而 CSS 指纹不变,封面必须重建
    await ensureThumb(root, absCss, 'fp-css-look', 'CSS', meta, 'look-b')
    expect(renderCalls.length).toBe(2)
  })
})