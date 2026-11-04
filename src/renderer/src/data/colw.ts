/* 缩略图列宽。滑块走对数刻度:170px 正好落在几何中点 √(90×320)=169.7,
   左半段留给高密度区(90~170),右半段留给大图区(170~320),线性的等像素步进在窄端太粗。 */
export const COLW_MIN = 90
export const COLW_MAX = 320
export const COLW_DEFAULT = 232
/** 滑块刻度总数:400 段时键盘每步约 0.7px 列宽,且 90~320 每个整数都能来回换算 */
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
