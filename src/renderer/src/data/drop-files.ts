export interface DropTransfer {
  types: readonly string[]
}

/** 系统文件拖入才激活导入态;应用内素材/文件夹拖拽不含 Files。 */
export function isExternalFileDrag(dataTransfer: DropTransfer | null | undefined): boolean {
  return dataTransfer?.types.includes('Files') === true
}

/** 只有真正放下文件才算;拖拽阴影在子元素间移动时 relatedTarget 不能误清状态。 */
export function leftDropZone(current: Element, relatedTarget: EventTarget | null): boolean {
  return relatedTarget == null || !current.contains(relatedTarget as Node)
}
