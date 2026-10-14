import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

describe('theme', () => {
  /** 伪造最小 localStorage:主题模块只依赖这一处持久化 */
  const loadTheme = async (mirror: string | null) => {
    vi.resetModules()
    const store = new Map<string, string>()
    if (mirror !== null) store.set('mediahub.theme', mirror)
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string): string | null => store.get(key) ?? null,
        setItem: (key: string, value: string): void => { store.set(key, value) }
      }
    })
    const mod = await import('../src/renderer/src/data/theme')
    return { mod, store }
  }

  it('reads the mirrored theme and falls back to light', async () => {
    const { mod } = await loadTheme('dark')
    expect(mod.readMirroredTheme()).toBe('dark')
    const { mod: empty } = await loadTheme(null)
    expect(empty.readMirroredTheme()).toBe('light')
    const { mod: junk } = await loadTheme('DARK')
    expect(junk.readMirroredTheme()).toBe('light')
  })

  it('writes the mirror under the key the first-paint script reads', async () => {
    const { mod, store } = await loadTheme(null)
    // 首帧内联脚本按字面量读这个键(index.html),改名必须同步改那边
    expect(mod.THEME_MIRROR_KEY).toBe('mediahub.theme')
    mod.writeMirroredTheme('dark')
    expect(store.get('mediahub.theme')).toBe('dark')
  })

  it('parses the theme out of a preferences payload', async () => {
    const { mod } = await loadTheme(null)
    expect(mod.parseTheme('{"theme":"dark"}')).toBe('dark')
    expect(mod.parseTheme('{"theme":"light"}')).toBe('light')
    expect(mod.parseTheme('{"theme":"neon"}')).toBe('light')
    expect(mod.parseTheme('{not json')).toBe('light')
    expect(mod.parseTheme(null)).toBe('light')
  })

  it('survives a storage that throws', async () => {
    vi.resetModules()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (): string | null => { throw new Error('denied') },
        setItem: (): void => { throw new Error('denied') }
      }
    })
    const mod = await import('../src/renderer/src/data/theme')
    expect(mod.readMirroredTheme()).toBe('light')
    expect(() => mod.writeMirroredTheme('dark')).not.toThrow()
  })
})

describe('applyTheme', () => {
  it('commits directly when the view transition cannot start', async () => {
    vi.resetModules()
    const attrs: Record<string, string> = {}
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (key: string, value: string): void => { attrs[key] = value },
        removeAttribute: (key: string): void => { delete attrs[key] },
        getAttribute: (key: string): string | null => attrs[key] ?? null
      },
      startViewTransition: (): never => { throw new Error('InvalidStateError') }
    })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const { applyTheme } = await import('../src/renderer/src/data/theme')
    applyTheme('light')
    applyTheme('dark')
    expect(attrs['data-theme']).toBe('dark')
    expect(() => applyTheme('light')).not.toThrow()
    expect(attrs['data-theme']).toBeUndefined()
  })
})

describe('first-paint theme script', () => {
  /* 首帧主题脚本的形态是回归点:CSP `script-src 'self'` 会拦截内联块并静默不执行,
     于是首帧退回浅色,表现为「先浅色再变深色」。这几条断言把「必须是外部同源经典
     脚本、且在模块脚本之前」钉住,防止有人图省事改回内联。 */
  const readSrc = (rel: string): string =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8')

  it('loads the theme script as a same-origin classic script before the module', () => {
    const html = readSrc('src/renderer/index.html')
    const boot = html.indexOf('<script src="./theme-boot.js"></script>')
    const module = html.indexOf('<script type="module"')
    expect(boot).toBeGreaterThan(-1)
    expect(module).toBeGreaterThan(-1)
    expect(boot).toBeLessThan(module)
    // 无 defer/async:经典脚本在解析时阻塞渲染,保证首个绘制帧前已执行
    expect(html).not.toMatch(/<script[^>]*theme-boot\.js[^>]*(defer|async)/)
  })

  it('keeps the CSP compatible: no inline script block is relied on', () => {
    const html = readSrc('src/renderer/index.html')
    expect(html).toMatch(/script-src 'self'/)
    expect(html).not.toMatch(/script-src[^;]*unsafe-inline/)
    // 除模块入口外,不应出现任何无 src 的 script 块(内联块会被 CSP 拦截)
    const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? []
    expect(inline).toEqual([])
  })

  it('reads the same mirror key and value the theme module writes', async () => {
    const boot = readSrc('src/renderer/public/theme-boot.js')
    const { THEME_MIRROR_KEY } = await import('../src/renderer/src/data/theme')
    expect(boot).toContain(`localStorage.getItem('${THEME_MIRROR_KEY}')`)
    expect(boot).toContain("setAttribute('data-theme', 'dark')")
  })
})
