export const THUMB_SIZE = 640
export const THUMB_CACHE_VERSION = 3
/**
 * 4:HTML 缩略图改为铺满取景(不再套 30px 内边距的白纸卡片)。
 * 5:HTML 缩略图先按内容边界裁掉四周空白再铺满,否则小卡片只占缩略框一小点。
 * 6:裁切容差收紧到 8、内容框改用 cover 铺满,避免卡片被误当成背景整片裁掉。
 * 7:HTML 缩略图改回渲染原文件并允许脚本执行;文档清洗会剥掉脚本,运行时渲染的页面只剩空白。
 */
export const DOCUMENT_RENDERER_VERSION = 7
