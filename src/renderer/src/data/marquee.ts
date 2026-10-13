/** 空白区刷选的几何判定:与 DOM 无关,便于直接测 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface MarqueeCandidate {
  id: string
  rect: Rect
}

/** 由起止点归一化出矩形(左上角 + 右下角),方向无关 */
export function marqueeRect(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    right: Math.max(ax, bx),
    bottom: Math.max(ay, by)
  }
}

/**
 * 框中哪些候选。判据是「有重叠面积」,四边严格不等 —— 所以正好贴边(相切)不算命中,
 * 这既是原来的行为,也是使用者的直觉:边框擦过卡片不该把它选进来。
 */
export function marqueeHits(box: Rect, candidates: readonly MarqueeCandidate[]): string[] {
  const hit: string[] = []
  for (const c of candidates) {
    if (c.rect.left < box.right && c.rect.right > box.left && c.rect.top < box.bottom && c.rect.bottom > box.top) {
      hit.push(c.id)
    }
  }
  return hit
}
