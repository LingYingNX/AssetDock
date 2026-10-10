/**
 * 缩略图宽高比的统一约束。
 *
 * 素材的原始比例可以极端到 1200x172(约 7:1 的字幕条)或手机长截图(约 1:6):
 * 前者在 232px 列宽下只剩 33px 高,缩略图比下面两行信息还矮,整张卡变成一条横线;
 * 后者能撑出上千像素,把瀑布流的整列拖走。
 *
 * 两端都收进 [1/2, 21/9],超出的部分交给 object-fit:cover 裁切:
 * - 下界 1/2 让 9:16 的竖屏视频(0.5625)完整保留,只截更瘦的长截图;
 * - 上界 21/9 保住标准宽银幕,再宽的按 21:9 显示。
 *
 * 这个值必须被两处一致消费,否则卡片会在瀑布流里错位:
 * - Card.tsx 写进 --ar,决定缩略图的真实高度(CSS)
 * - Grid.tsx 的 estHeight,决定虚拟化时的列内定位
 *
 * 缩略图 : 信息区 的目标面积比是 80 : 20,由 Grid.tsx 的 CAPTION_H(44) 与本函数的
 * 下界共同保证:232px 列宽 / 4:3 缩略图下是 174 : 218 = 79.8%。列宽越大缩略图占比越高
 * (320px 时 84.5%),因为信息区高度不随列宽变化。
 */
export const MIN_THUMB_AR = 1 / 2
export const MAX_THUMB_AR = 21 / 9

/** 无尺寸素材沿用 4:3,与 .thumb 的 aspect-ratio 兜底一致 */
export const FALLBACK_THUMB_AR = 4 / 3

/** 素材展示比例:有宽高则 clamp,否则返回 undefined 交给 CSS 兜底 */
export function thumbRatio(width?: number, height?: number): number | undefined {
  if (!width || !height) return undefined
  return Math.min(MAX_THUMB_AR, Math.max(MIN_THUMB_AR, width / height))
}