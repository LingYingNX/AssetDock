/**
 * 主题:浅色/夜间切换。主题写在 <html data-theme> 上,CSS 令牌按该属性覆盖。
 *
 * 记录分两处:
 * - `preferences` 键(主进程 app_state)是权威记录,与其它偏好同一份;
 * - localStorage 的 `mediahub.theme` 是首帧镜像——启动时渲染层还没走到
 *   `restoreUiPrefs()`,只有内联脚本能同步读到它(见 index.html)。
 * 权威与镜像不一致时以权威为准,启动引导会把镜像校正回来。
 */

export type ThemeMode = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'preferences'

/**
 * 首帧镜像键。`src/renderer/index.html` 的 <head> 内联脚本按同样的字面量读取
 * (内联脚本先于模块执行,无法 import 本文件),改这里必须同步改那里。
 */
export const THEME_MIRROR_KEY = 'mediahub.theme'

/** 读首帧镜像;缺失或非法一律当浅色,存储不可用也不抛错 */
export function readMirroredTheme(): ThemeMode {
  try {
    return window.localStorage.getItem(THEME_MIRROR_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** 写首帧镜像(只在确立权威值时调用:启动校正、保存偏好)。失败静默。 */
export function writeMirroredTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_MIRROR_KEY, mode)
  } catch {
    /* 镜像写失败不影响外观 */
  }
}

/**
 * 应用主题到根元素(立即生效,无需重渲染)。
 *
 * 主题切换不能靠 CSS transition:实测把 background-image 加进过渡后,
 * 五层 radial-gradient 在切换后的第一帧(t=10ms)就跳到深色值,全程零中间帧——
 * 渐变不可插值,而全窗口的明暗几乎全部来自 body 的那五层渐变。
 * transition 也修不了它:能插值的只有 color 这类标量。
 * 所以改用 View Transition:浏览器在切换前后各抓一张整窗快照,自行交叉淡入
 * (实测 old 1→0、new 0→1,250ms),这才是主题切换唯一能真正「有过渡」的做法。
 * Electron 33 实测 document.startViewTransition 为 function,可用。
 *
 * 本函数只负责外观,不写镜像:偏好面板里的预览不是「已保存的主题」,
 * 让它落盘会留下镜像与权威不一致的脏值(写入点见模块注释)。
 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement
  // booted 必须在幂等判断之前落定:启动时若保存的是浅色,属性本就缺失,
  // 下面的 currentTheme()===mode 会直接返回——那之后用户第一次真正切换
  // 就会被误当成「启动恢复」而不播过渡。
  const first = !booted
  booted = true
  if (currentTheme() === mode) return

  const commit = (): void => {
    if (mode === 'dark') root.setAttribute('data-theme', 'dark')
    else root.removeAttribute('data-theme')
  }

  // 启动时恢复已保存主题不该播过渡:那是首帧内容,不是用户触发的切换
  if (first) {
    commit()
    return
  }

  // 用户要求减少动效时不抓快照:整窗交叉淡入本身就不算「少动」
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || typeof document.startViewTransition !== 'function') {
    commit()
    return
  }
  // 过渡本身失败不能让主题不生效:抓快照在文档不可用或已有过渡在跑时会同步抛错,
  // 那时外观停在旧主题而单选已经切换,正是"勾选夜间、外观白天"的形态,退回直接提交。
  try {
    document.startViewTransition(commit)
  } catch {
    commit()
  }
}

let booted = false

/** 读出当前实际生效的主题(属性缺失即浅色) */
export function currentTheme(): ThemeMode {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
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
