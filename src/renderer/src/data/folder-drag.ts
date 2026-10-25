export type FolderPlacement = 'before' | 'after' | 'inside'

export interface OptimisticFolderMove {
  path: string
  paths: string[]
  /** 目标下已有同一路径时磁盘侧不会移动;调用方据此直接拒绝,不发 IPC */
  conflict: boolean
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
  if (targetIndex < 0 || block.length === 0) return { path, paths: paths.slice(), conflict: false }
  // 目标下已有同名文件夹时磁盘侧必然失败,乐观更新不得凭空造出重复路径:
  // 重复路径 = React key 相同,树会渲染出两行并留下回收不掉的残留行与卡住的落点描边。
  // 整棵被移动子树的每个路径都要查重,不只查源自身。
  const rebasedPaths = block.map((item) => rebaseFolderPath(item, source, path))
  if (rebasedPaths.some((item) => rest.includes(item))) return { path: source, paths: paths.slice(), conflict: true }

  let insertAt = targetIndex
  if (placement !== 'before') {
    insertAt++
    while (insertAt < rest.length && rest[insertAt].startsWith(`${target}/`)) insertAt++
  }
  return { path, paths: [...rest.slice(0, insertAt), ...rebasedPaths, ...rest.slice(insertAt)], conflict: false }
}

export function canDropFolder(source: string | null, target: string, placement: FolderPlacement, targetMovable: boolean): boolean {
  if (!source || !targetMovable) return false
  if (source === target || target.startsWith(`${source}/`)) return false
  return placement !== 'inside' || parentPath(source) !== target
}
