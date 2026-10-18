/** 解析模型外部 buffer/贴图时使用的目录基准。 */
export function modelBaseUrl(url: string): string {
  try {
    return new URL('.', url).href
  } catch {
    return ''
  }
}
