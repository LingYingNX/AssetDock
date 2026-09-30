import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_SHELL, buildPreviewHtml, resolvePreviewShell, shellFromCss, stripScripts } from '../src/main/services/cssPreview'

describe('css preview shell', () => {
  it('inlines the css and keeps it intact', () => {
    const css = '.loader{color:seagreen}\\n.loader span{animation:radar81 2s linear infinite}'
    const html = buildPreviewHtml(css)
    expect(html).toContain('.loader{color:seagreen}')
    expect(html).toContain('animation:radar81 2s linear infinite')
  })

  it('strips scripts from the shell', () => {
    const html = buildPreviewHtml('.a{}', '<div class="a">x</div><script>alert(1)</script>')
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('<script')
    expect(html).toContain('<div class="a">x</div>')
  })

  it('removes self-closing script tags too', () => {
    expect(stripScripts('<script src="x.js"/>ok')).toBe('ok')
  })

  it('injects the preview CSP', () => {
    const html = buildPreviewHtml('.a{}')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
  })

  it('escapes a premature style terminator inside css text', () => {
    const html = buildPreviewHtml('.a{content:"</style>"}')
    expect(html.includes('</style>')).toBe(true)
    // 只有注入的两个 style 块能闭合,用户文本里的必须被转义
    expect(html.match(/<\/style>/g)?.length).toBe(2)
  })

  it('falls back to the built-in shell', () => {
    const html = buildPreviewHtml('.btn{}')
    expect(html).toContain('class="btn button"')
    expect(BUILT_IN_SHELL).toContain('loader')
  })

  it('derives demo markup from the css selectors so components get hit', () => {
    // 站点收集来的组件类名固定骨架里没有,必须由 CSS 自己的选择器反推出来
    const html = buildPreviewHtml('.input{background:#0D1117}\n.value{color:#fff}\n.value svg{width:15px}')
    expect(html).toMatch(/class="input"/)
    expect(html).toMatch(/class="value"/)
    expect(html).toContain('<svg')
  })

  it('uses the derived markup ahead of the built-in shell', () => {
    const html = buildPreviewHtml('.dropdown .item{padding:8px}')
    expect(html).toMatch(/class="dropdown"/)
    expect(html).toMatch(/class="item"/)
    expect(html).toContain('class="dropdown"')
  })

  it('ignores pseudo-elements and at-rules when reading selectors', () => {
    // @keyframes 与 ::before 是 CSS 自身的产物,不该在骨架里生成对应节点
    const shell = shellFromCss('@keyframes spin{to{transform:rotate(360deg)}}\n.badge::before{content:""}\n.badge{color:red}')
    expect(shell).toMatch(/class="badge"/)
    expect(shell).not.toContain('@keyframes')
    expect(shell).not.toContain('spin')
  })

  it('injects into a full document shell without dropping its body', () => {
    const shell = '<html><head><title>t</title></head><body><div class="x">hi</div></body></html>'
    const html = buildPreviewHtml('.x{color:red}', shell)
    expect(html).toContain('<title>t</title>')
    expect(html).toContain('<div class="x">hi</div>')
    expect(html.match(/<head>/gi)?.length).toBe(1)
  })

  it('prefers a same-named html shell next to the css', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-css-shell-'))
    try {
      await mkdir(join(root, 'styles'))
      await writeFile(join(root, 'styles', 'loader.css'), '.loader{}')
      await writeFile(join(root, 'styles', 'loader.html'), '<div class="loader">custom</div>')
      await expect(resolvePreviewShell(root, 'styles/loader.css')).resolves.toContain('custom')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null when no shell exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-css-noshell-'))
    try {
      await writeFile(join(root, 'loader.css'), '.loader{}')
      await expect(resolvePreviewShell(root, 'loader.css')).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})