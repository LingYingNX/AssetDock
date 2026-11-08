/**
 * 胶片传送带的窗口计算。
 *
 * 4105 个素材全塞进 DOM 时可见的只有 9 个,99.8% 的节点纯属浪费。这里按滚动位置
 * 只算出该渲染的那一段,两侧用占位块撑出总宽度,滚动条长度因此仍然正确。
 *
 * 抽成纯函数以便测试:窗口算错会表现为「滚到某处突然空白」,这种 bug 靠肉眼很难定位。
 */

/**
 * 单个胶片格的占宽 = 缩略图宽度 + 格间距,需与 lightbox.css 的 .pv-reel 保持一致。
 * 这只是兜底值:窄屏容器查询会改 .pv-reel 宽度,所以 Filmstrip 会在运行时
 * 实测格宽与间距再覆盖(见 Filmstrip 的 metrics),避免两边再次漂移。
 */
export const REEL_W = 96
export const REEL_GAP = 7
export const REEL_PITCH = REEL_W + REEL_GAP

/** 视口外额外多渲染几格,快速滚动时不留白 */
export const REEL_OVERSCAN = 12

/** 素材数低于此值直接全渲染:窗口化本身有成本,小库不值得 */
export const REEL_WINDOW_THRESHOLD = 200

export interface StripWindow {
  /** 首个参与渲染的下标(含) */
  start: number
  /** 末个参与渲染的下标(不含) */
  end: number
  /** 左侧占位块宽度(px) */
  padLeft: number
  /** 右侧占位块宽度(px) */
  padRight: number
}

/**
 * 依滚动位置算出要渲染的下标区间。
 *
 * 空视口或空列表返回零宽区间,让调用方可以无脑渲染而不必先判边界。
 */
export function stripWindow(
  scrollLeft: number,
  viewport: number,
  total: number,
  pitch = REEL_PITCH,
  overscan = REEL_OVERSCAN,
  padStart = 0,
  padEnd = 0
): StripWindow {
  if (total <= 0) return { start: 0, end: 0, padLeft: 0, padRight: 0 }
  const first = Math.floor(Math.max(0, scrollLeft - padStart) / pitch) - overscan
  const last = Math.ceil((Math.max(0, scrollLeft - padStart) + Math.max(0, viewport)) / pitch) + overscan
  const start = Math.max(0, Math.min(total, first))
  const end = Math.max(start, Math.min(total, last))
  return {
    start,
    end,
    padLeft: padStart + start * pitch,
    padRight: padEnd + (total - end) * pitch
  }
}

/**
 * 让第 index 格居中的目标滚动位置(两侧不足时夹到边界)。
 *
 * itemW 是格子的实际宽度(不等于 pitch,后者含间距),居中要对准格子中点。
 */
export function scrollLeftForIndex(
  index: number,
  viewport: number,
  total: number,
  pitch = REEL_PITCH,
  itemW = pitch,
  padStart = 0,
  padEnd = 0
): number {
  if (total <= 0) return 0
  const centered = padStart + index * pitch + itemW / 2 - Math.max(0, viewport) / 2
  const maxScroll = Math.max(0, padStart + total * pitch + padEnd - Math.max(0, viewport))
  return Math.max(0, Math.min(maxScroll, centered))
}
