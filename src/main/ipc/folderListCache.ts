/** 目录树缓存:文件夹增删改时失效,切标签页不必重新递归遍历整个库 */
const folderLists = new Map<number, string[]>()

export function cachedFolderList(libraryId: number): string[] | undefined {
  return folderLists.get(libraryId)
}

export function cacheFolderList(libraryId: number, paths: string[]): void {
  folderLists.set(libraryId, paths)
}

export function invalidateFolderList(libraryId: number): void {
  folderLists.delete(libraryId)
}
