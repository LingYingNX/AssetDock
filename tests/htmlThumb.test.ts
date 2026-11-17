import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 只关心「HTML 走原文件整页渲染」这条路由:离屏 Chromium 用假实现替代
const rendered: string[] = []
vi.mock('../src/main/services/cssThumb', () => ({
  renderHtmlThumbFromFile: async (absPath: string) => {
    rendered.push(absPath)
    const sharp = (await import('sharp')).default
    return sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 40, g: 90, b: 160 } } })
      .jpeg()
      .toBuffer()
  }
}))

import { ensureThumb, flushManifest, resetThumbCache } from '../src/main/services/thumbs'

describe('html thumbnail branch', () => {
  let root = ''
  beforeEach(async () => {
    resetThumbCache()
    rendered.length = 0
    root = await mkdtemp(join(tmpdir(), 'mediahub-html-thumb-'))
  })
  afterEach(async () => {
    resetThumbCache()
    await rm(root, { recursive: true, force: true })
  })

  it('renders the original file instead of the sanitized document preview', async () => {
    const abs = join(root, 'page.html')
    // 正文由运行时脚本挂载:文档清洗会剥掉脚本,只剩空 body
    await writeFile(abs, '<!doctype html><html><body><div id="app"></div><script>document.getElementById("app").textContent="hi"</script></body></html>')

    const result = await ensureThumb(root, abs, 'fp-html-branch', 'HTML', { relPath: 'page.html', mtimeMs: 1, sizeBytes: 20 })

    expect(rendered).toEqual([abs])
    expect(result.placeholder).toBe(false)
    expect(await readFile(result.path).then((b) => b.length > 0, () => false)).toBe(true)
    await flushManifest(root)
  })

  it('routes .htm (normalized to HTML) through the same renderer', async () => {
    const abs = join(root, 'page.htm')
    await writeFile(abs, '<html><body>static</body></html>')

    await ensureThumb(root, abs, 'fp-htm-branch', 'HTML', { relPath: 'page.htm', mtimeMs: 1, sizeBytes: 20 })

    expect(rendered).toEqual([abs])
    await flushManifest(root)
  })
})
