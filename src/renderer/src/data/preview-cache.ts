/**
 * 已成功解码的预览 URL 集合。
 *
 * 切换文件夹时素材列表整体重建,卡片会重新挂载;若每次都从 opacity:0 淡入,
 * 用户看到的就是"缩略图重新刷新并加载"。这份集合让重挂载的卡片直接以可见态渲染,
 * 只有真正首次解码的图片才播放淡入。
 *
 * 有界:超过上限时整体清空(缓存头已保证字节命中,退化为一次淡入无碍)。
 */
const decoded = new Set<string>()
const MAX_ENTRIES = 5000

export function isPreviewDecoded(url: string): boolean {
  return url !== '' && decoded.has(url)
}

export function markPreviewDecoded(url: string): void {
  if (url === '') return
  if (decoded.size >= MAX_ENTRIES) decoded.clear()
  decoded.add(url)
}