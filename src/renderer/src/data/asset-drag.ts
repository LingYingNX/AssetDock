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
