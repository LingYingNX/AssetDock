/* 缩略图列宽。下限保持设计稿的 170px:再窄缩略图与文件名都会小到无法辨认。
   滑块走对数刻度,窄端步进更细。 */
export const COLW_MIN = 170
export const COLW_MAX = 320
export const COLW_DEFAULT = 232
/** 滑块刻度总数:400 段时键盘每步约 0.4px 列宽,且 170~320 每个整数都能来回换算 */
export const COLW_STEPS = 400

export function clampColw(value: number): number {
  if (!Number.isFinite(value)) return COLW_DEFAULT
  return Math.min(COLW_MAX, Math.max(COLW_MIN, Math.round(value)))
}

export function colwToSlider(colw: number): number {
  const t = Math.log(clampColw(colw) / COLW_MIN) / Math.log(COLW_MAX / COLW_MIN)
  return Math.round(t * COLW_STEPS)
}

export function sliderToColw(value: number): number {
  const t = Math.min(1, Math.max(0, value / COLW_STEPS))
  return clampColw(COLW_MIN * (COLW_MAX / COLW_MIN) ** t)
}
/**
 * 虚拟化布局的列宽分配:先按 colw 定列数,再把剩余宽度摊回每列。
 * 直接用 colw 当列宽时,容器右侧会留下一条不足一列的空白,窗口越窄越明显。
 */
export function fitColumns(avail: number, colw: number, gap: number): { cols: number; width: number } {
  const cols = Math.max(1, Math.floor((avail + gap) / (colw + gap)))
  return { cols, width: Math.max(1, Math.floor((avail - (cols - 1) * gap) / cols)) }
}