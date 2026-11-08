export const MEDIA_ASSETS_DRAG_TYPE = 'application/x-mediahub-assets'

export function encodeAssetDrag(assetIds: readonly string[]): string {
  return JSON.stringify(assetIds)
}

export function decodeAssetDrag(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function isAssetDrag(event: { dataTransfer: DataTransfer | null }): boolean {
  return event.dataTransfer?.types.includes(MEDIA_ASSETS_DRAG_TYPE) ?? false
}

/**
 * Chromium 在 Windows 把 DownloadURL 转成 CF_HDROP。不能改用
 * webContents.startDrag：它会阻断应用内 drop（electron/electron#7118）。
 */
export function downloadUrlForPath(absPath: string): string | null {
  const normalized = absPath.replace(/\\/g, '/')
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1)
  if (!fileName) return null
  const encoded = normalized
    .split('/')
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
  const url = normalized.startsWith('//')
    ? `file:${encoded}`
    : /^[A-Za-z]:\//.test(normalized)
      ? `file:///${encoded}`
      : `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`
  return `application/octet-stream:${fileName}:${url}`
}
