export type FolderPlacement = 'before' | 'after' | 'inside'

export interface OptimisticFolderMove {
  path: string
  paths: string[]
}

export function folderDropClass(placement: FolderPlacement): string {
  return `folder-drop-${placement}`
}

export function folderDropPlacement(offsetY: number, rowHeight: number): FolderPlacement {
  const edge = rowHeight / 4
  if (offsetY < edge) return 'before'
  if (offsetY > rowHeight - edge) return 'after'
  return 'inside'
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

export function rebaseFolderPath(path: string, source: string, target: string): string {
  if (path === source) return target
  return path.startsWith(`${source}/`) ? `${target}${path.slice(source.length)}` : path
}

export function optimisticFolderMove(paths: readonly string[], source: string, target: string, placement: FolderPlacement): OptimisticFolderMove {
  const name = source.slice(source.lastIndexOf('/') + 1)
  const destinationParent = placement === 'inside' ? target : parentPath(target)
  const path = destinationParent ? `${destinationParent}/${name}` : name
  const block = paths.filter((item) => item === source || item.startsWith(`${source}/`))
  const rest = paths.filter((item) => !block.includes(item))
  const targetIndex = rest.indexOf(target)
  if (targetIndex < 0 || block.length === 0) return { path, paths: paths.slice() }

  let insertAt = targetIndex
  if (placement !== 'before') {
    insertAt++
    while (insertAt < rest.length && rest[insertAt].startsWith(`${target}/`)) insertAt++
  }
  const rebased = block.map((item) => rebaseFolderPath(item, source, path))
  return { path, paths: [...rest.slice(0, insertAt), ...rebased, ...rest.slice(insertAt)] }
}

export function canDropFolder(source: string | null, target: string, placement: FolderPlacement, targetMovable: boolean): boolean {
  if (!source || !targetMovable) return false
  if (source === target || target.startsWith(`${source}/`)) return false
  return placement !== 'inside' || parentPath(source) !== target
}
