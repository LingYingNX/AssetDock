/** 解析模型外部 buffer/贴图时使用的目录基准。 */
export function modelBaseUrl(url: string): string {
  try {
    return new URL('.', url).href
  } catch {
    return ''
  }
}

/** OBJ 的 mtllib 行 → 绝对 URL;3ds Max 常写反斜杠,统一成 URL 分隔符。 */
export function objMaterialUrls(objText: string, baseUrl: string): string[] {
  if (!baseUrl) return []
  const urls = new Set<string>()
  for (const match of objText.matchAll(/^mtllib\s+(.+)$/gim)) {
    const name = match[1].trim().replace(/\\/g, '/')
    if (!name) continue
    try {
      urls.add(new URL(name, baseUrl).href)
    } catch {
      /* 无效路径交给下一行材质库 */
    }
  }
  return [...urls]
}
