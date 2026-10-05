/**
 * 胶片传送带的窗口计算。
 *
 * 4105 个素材全塞进 DOM 时可见的只有 9 个,99.8% 的节点纯属浪费。这里按滚动位置
 * 只算出该渲染的那一段,两侧用占位块撑出总宽度,滚动条长度因此仍然正确。
 *
 * 抽成纯函数以便测试:窗口算错会表现为「滚到某处突然空白」,这种 bug 靠肉眼很难定位。
 */

/** 单个胶片格的占宽 = 缩略图宽度 + 格间距,需与 lightbox.css 的 .pv-reel / gap 保持一致 */
export const REEL_W = 84
export const REEL_GAP = 6
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
  overscan = REEL_OVERSCAN
): StripWindow {
  if (total <= 0) return { start: 0, end: 0, padLeft: 0, padRight: 0 }
  const first = Math.floor(Math.max(0, scrollLeft) / pitch) - overscan
  const last = Math.ceil((Math.max(0, scrollLeft) + Math.max(0, viewport)) / pitch) + overscan
  const start = Math.max(0, Math.min(total, first))
  const end = Math.max(start, Math.min(total, last))
  return {
    start,
    end,
    padLeft: start * pitch,
    padRight: (total - end) * pitch
  }
}

/** 让第 index 格居中的目标滚动位置(两侧不足时夹到边界) */
export function scrollLeftForIndex(index: number, viewport: number, total: number, pitch = REEL_PITCH): number {
  if (total <= 0) return 0
  const centered = index * pitch - (Math.max(0, viewport) - pitch) / 2
  const maxScroll = Math.max(0, total * pitch - Math.max(0, viewport))
  return Math.max(0, Math.min(maxScroll, centered))
}
