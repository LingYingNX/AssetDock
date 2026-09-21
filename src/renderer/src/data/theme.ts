/**
 * 主题:浅色/夜间切换。主题写在 <html data-theme> 上,CSS 令牌按该属性覆盖;
 * 落盘复用 preferences 键,与其它偏好同一份记录。
 */

export type ThemeMode = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'preferences'

/** 应用主题到根元素(立即生效,无需重渲染) */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  if (mode === 'dark') root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
}

/** 从偏好 JSON 中解析主题,非法值回退浅色 */
export function parseTheme(raw: string | null): ThemeMode {
  if (!raw) return 'light'
  try {
    const value = JSON.parse(raw) as { theme?: unknown }
    return value.theme === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}
