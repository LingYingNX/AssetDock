export interface PanOffset {
  x: number
  y: number
}

/**
 * 把缩放后的元素盒子约束在容器内。
 *
 * transform-origin 不在中心时,缩放本身就会把盒子往一侧推,所以上下界不对称:
 * 原点在 20% 处时,向右可移动 20% 的溢出量,向左可移动 80%。
 * scale <= 1 时没有溢出,偏移必须归零。
 */
export function clampPanOffset(
  offset: PanOffset,
  scale: number,
  originX: number,
  originY: number,
  width: number,
  height: number
): PanOffset {
  const overflowX = Math.max(0, width * (scale - 1))
  const overflowY = Math.max(0, height * (scale - 1))
  const maxX = overflowX * originX
  const minX = -overflowX * (1 - originX)
  const maxY = overflowY * originY
  const minY = -overflowY * (1 - originY)
  const clamp = (value: number, min: number, max: number): number => {
    const next = Math.min(max, Math.max(min, value))
    return next === 0 ? 0 : next
  }
  return {
    x: clamp(offset.x, minX, maxX),
    y: clamp(offset.y, minY, maxY)
  }
}
