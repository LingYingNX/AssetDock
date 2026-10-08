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
