import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { SWATCHES } from '../data/dataset'
import { sidebarCounts } from '../data/query'
import { MEDIA_ASSETS_DRAG_TYPE, decodeAssetDrag, isAssetDrag } from '../data/asset-drag'
import { type FolderPlacement, canDropFolder, folderDropClass, folderDropPlacement } from '../data/folder-drag'
import { Icon } from './Icons'

interface DirNode {
  path: string
  label: string
  count: number
  children: DirNode[]
  movable: boolean
}

interface FolderDrop {
  target: string
  placement: FolderPlacement
}

const FOLDER_DRAG_TYPE = 'application/x-mediahub-folder'
const FOLDER_DROP_PLACEMENTS: FolderPlacement[] = ['before', 'inside', 'after']

function setFolderDropIndicator(element: HTMLDivElement | null, placement: FolderPlacement | null): void {
  if (!element) return
  for (const item of FOLDER_DROP_PLACEMENTS) element.classList.remove(folderDropClass(item))
  if (placement) element.classList.add(folderDropClass(placement))
}

function isFolderDrag(event: React.DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes(FOLDER_DRAG_TYPE)
}

function folderFromDrag(event: React.DragEvent<HTMLElement>): string | null {
  return event.dataTransfer.getData(FOLDER_DRAG_TYPE) || null
}

function folderDragPreview(source: HTMLElement, label: string): HTMLDivElement {
  const preview = document.createElement('div')
  preview.className = 'folder-drag-preview'
  const icon = source.querySelector('.folder-main .ic')?.cloneNode(true)
  if (icon) preview.append(icon)
  const name = document.createElement('span')
  name.textContent = label
  preview.append(name)
  document.body.appendChild(preview)
  return preview
}

/** 库模式:只用真实目录建树,素材路径仅用于节点计数 */
function buildDirTree(paths: string[], assets: { folders: string[]; missing?: boolean; deletedAt?: string }[], movablePaths: Set<string>): DirNode[] {
  const counts = new Map<string, number>()
  for (const a of assets) {
    if (a.missing || a.deletedAt) continue
    for (const f of a.folders) counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  return buildTree(paths, counts, movablePaths)
}

function buildTree(paths: string[], counts: Map<string, number>, movablePaths: Set<string>): DirNode[] {
  const root: DirNode[] = []
  const byPath = new Map<string, DirNode>()
  for (const path of paths) {
    const segs = path.split('/')
    const label = segs[segs.length - 1]
    const node: DirNode = { path, label, count: counts.get(path) ?? 0, children: [], movable: movablePaths.has(path) }
    byPath.set(path, node)
  }
  for (const path of paths) {
    const node = byPath.get(path)
    if (!node) continue
    const separator = path.lastIndexOf('/')
    const parentPath = separator < 0 ? '' : path.slice(0, separator)
    const parent = parentPath ? byPath.get(parentPath) : undefined
    if (parent) parent.children.push(node)
    else root.push(node) // 父目录缺数据时兜底挂根
  }
  return root
}

function FolderNameEditor({ name, onCommit, onCancel }: { name: string; onCommit: (name: string) => void; onCancel: () => void }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(name)
  const valueRef = useRef(value)
  valueRef.current = value
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const cancelled = useRef(false)
  const commit = (): void => {
    if (cancelled.current) return
    cancelled.current = true
    onCommitRef.current(valueRef.current)
  }

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  useEffect(() => {
    const commitOutside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) commit()
    }
    document.addEventListener('pointerdown', commitOutside, true)
    return () => document.removeEventListener('pointerdown', commitOutside, true)
  }, [])

  return (
    <input
      ref={ref}
      className="folder-name-edit"
      value={value}
      aria-label="文件夹名称"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          cancelled.current = true
          onCancel()
        }
      }}
      onBlur={commit}
    />
  )
}

function DirTree({
  nodes,
  depth,
  nav,
  setNav,
  editingPath,
  onCommit,
  onCancel,
  collapsedPaths,
  onToggleCollapsed,
  onAssetDragOverFolder,
  onAssetDragLeaveFolder,
  onAssetDropFolder,
  folderDropRef,
  folderDragSource,
  onFolderDragStart,
  onFolderDragEnd,
  onFolderDragOver,
  onFolderDragLeave,
  onFolderDrop
}: {
  nodes: DirNode[]
  depth: number
  nav: string
  setNav: (n: never) => void
  editingPath: string | null
  onCommit: (path: string, name: string) => void
  onCancel: () => void
  collapsedPaths: Set<string>
  onToggleCollapsed: (path: string) => void
  onAssetDragOverFolder: (element: HTMLDivElement) => void
  onAssetDragLeaveFolder: (element: HTMLDivElement, event: React.DragEvent<HTMLDivElement>) => void
  onAssetDropFolder: (path: string, event: React.DragEvent<HTMLDivElement>) => void
  folderDropRef: React.MutableRefObject<FolderDrop | null>
  folderDragSource: () => string | null
  onFolderDragStart: (path: string, preview: HTMLDivElement) => void
  onFolderDragEnd: () => void
  onFolderDragOver: (element: HTMLDivElement, path: string, placement: FolderPlacement) => void
  onFolderDragLeave: (path: string, event: React.DragEvent<HTMLDivElement>) => void
  onFolderDrop: (path: string, event: React.DragEvent<HTMLDivElement>, placement: FolderPlacement) => void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((n) => {
        const key = `folder:${n.path}`
        const on = nav === key
        const collapsed = collapsedPaths.has(n.path)
        return (
          <div key={n.path}>
            {editingPath === n.path ? (
              <div className="nav-item on folder-edit" style={{ paddingLeft: 10 + depth * 14 }}>
                <Icon name="folder" />
                <FolderNameEditor name={n.label} onCommit={(name) => onCommit(n.path, name)} onCancel={onCancel} />
                <span className="cnt">{n.count}</span>
              </div>
            ) : (
              <div
                className={`nav-item folder-row${on ? ' on' : ''}${n.children.length > 0 ? ' has-children' : ''}`}
                style={{ paddingLeft: 10 + depth * 14, '--folder-depth': depth } as React.CSSProperties}
                draggable={n.movable}
                onDragStart={(event) => {
                  if (!n.movable) return
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData(FOLDER_DRAG_TYPE, n.path)
                  const preview = folderDragPreview(event.currentTarget, n.label)
                  event.dataTransfer.setDragImage(preview, 18, 15)
                  onFolderDragStart(n.path, preview)
                }}
                onDragEnd={onFolderDragEnd}
                onDragOver={(e) => {
                  if (isAssetDrag(e) && n.movable) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    onAssetDragOverFolder(e.currentTarget)
                  } else if (isFolderDrag(e)) {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const placement = folderDropPlacement(e.clientY - rect.top, rect.height)
                    if (canDropFolder(folderDragSource() || folderFromDrag(e), n.path, placement, n.movable)) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      onFolderDragOver(e.currentTarget, n.path, placement)
                    }
                  }
                }}
                onDragLeave={(e) => {
                  onAssetDragLeaveFolder(e.currentTarget, e)
                  onFolderDragLeave(n.path, e)
                }}
                onDrop={(e) => {
                  if (isAssetDrag(e)) onAssetDropFolder(n.path, e)
                  else if (isFolderDrag(e) && folderDropRef.current?.target === n.path) onFolderDrop(n.path, e, folderDropRef.current.placement)
                }}
                data-folder-path={n.path}
              >
                {n.children.length > 0 && (
                  <button
                    className={`folder-toggle${collapsed ? '' : ' open'}`}
                    title={collapsed ? '展开子文件夹' : '收起子文件夹'}
                    aria-label={collapsed ? '展开子文件夹' : '收起子文件夹'}
                    aria-expanded={!collapsed}
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleCollapsed(n.path)
                    }}
                  >
                    <Icon name="chev-r" />
                  </button>
                )}
                <button className="folder-main" onClick={() => setNav(key as never)} title={n.label}>
                  <Icon name="folder" />
                  <span className="folder-label">{n.label}</span>
                  <span className="cnt">{n.count}</span>
                </button>
              </div>
            )}
            {n.children.length > 0 && !collapsed && (
              <DirTree
                nodes={n.children}
                depth={depth + 1}
                nav={nav}
                setNav={setNav}
                editingPath={editingPath}
                onCommit={onCommit}
                onCancel={onCancel}
                collapsedPaths={collapsedPaths}
                onToggleCollapsed={onToggleCollapsed}
                onAssetDragOverFolder={onAssetDragOverFolder}
                onAssetDragLeaveFolder={onAssetDragLeaveFolder}
                onAssetDropFolder={onAssetDropFolder}
                folderDropRef={folderDropRef}
                folderDragSource={folderDragSource}
                onFolderDragStart={onFolderDragStart}
                onFolderDragEnd={onFolderDragEnd}
                onFolderDragOver={onFolderDragOver}
                onFolderDragLeave={onFolderDragLeave}
                onFolderDrop={onFolderDrop}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

export function Sidebar(): React.JSX.Element {
  const nav = useUI((s) => s.nav)
  const setNav = useUI((s) => s.setNav)
  const swatches = useUI((s) => s.swatches)
  const toggleSwatch = useUI((s) => s.toggleSwatch)
  const clearSwatches = useUI((s) => s.clearSwatches)
  const assets = useUI((s) => s.assets)
  const mode = useUI((s) => s.mode)
  const folderPaths = useUI((s) => s.folderPaths)
  const physicalFolderPaths = useUI((s) => s.physicalFolderPaths)
  const folderEditPath = useUI((s) => s.folderEditPath)
  const createFolder = useUI((s) => s.createFolder)
  const renameFolder = useUI((s) => s.renameFolder)
  const cancelFolderRename = useUI((s) => s.cancelFolderRename)
  const moveFolder = useUI((s) => s.moveFolder)
  const moveAssetsToFolder = useUI((s) => s.moveAssetsToFolder)
  const assetDropTargetRef = useRef<HTMLElement | null>(null)
  const folderDragPreviewRef = useRef<HTMLDivElement | null>(null)
  const folderDropTargetRef = useRef<HTMLDivElement | null>(null)
  const folderDropRef = useRef<FolderDrop | null>(null)
  const folderDragSourceRef = useRef<string | null>(null)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set())
  const c = sidebarCounts(assets)
  const tagStats = assets.reduce<Record<string, { color: string; n: number }>>((acc, a) => {
    if (a.missing || a.deletedAt) return acc
    for (const t of a.tags) {
      acc[t.name] = acc[t.name] ?? { color: t.color, n: 0 }
      acc[t.name].n++
    }
    return acc
  }, {})

  const dirTree = mode === 'library' ? buildDirTree(folderPaths, assets, new Set(physicalFolderPaths)) : []

  const setAssetDropTarget = (element: HTMLElement | null): void => {
    if (assetDropTargetRef.current === element) return
    assetDropTargetRef.current?.classList.remove('drop-target')
    assetDropTargetRef.current = element
    element?.classList.add('drop-target')
  }

  const moveDrop = (folder: string, event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setAssetDropTarget(null)
    const encoded = event.dataTransfer.getData(MEDIA_ASSETS_DRAG_TYPE) || event.dataTransfer.getData('text/plain')
    const assetIds = decodeAssetDrag(encoded)
    if (assetIds.length > 0) moveAssetsToFolder(assetIds, folder)
  }

  const toggleCollapsed = (path: string): void => {
    setCollapsedPaths((paths) => {
      const next = new Set(paths)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const updateFolderDrop = (element: HTMLDivElement | null, drop: FolderDrop | null): void => {
    const previous = folderDropTargetRef.current
    if (previous !== element || folderDropRef.current?.placement !== drop?.placement) {
      setFolderDropIndicator(previous, null)
      setFolderDropIndicator(element, drop?.placement ?? null)
    }
    folderDropTargetRef.current = element
    folderDropRef.current = drop
  }

  const clearFolderDrop = (): void => {
    updateFolderDrop(null, null)
  }

  const clearFolderDrag = (): void => {
    folderDragPreviewRef.current?.remove()
    folderDragPreviewRef.current = null
    folderDragSourceRef.current = null
    clearFolderDrop()
  }

  const dropFolder = (target: string, event: React.DragEvent<HTMLElement>, placement: FolderPlacement, targetMovable: boolean): void => {
    event.preventDefault()
    const source = folderFromDrag(event) || folderDragSourceRef.current
    clearFolderDrag()
    if (source && canDropFolder(source, target, placement, targetMovable)) moveFolder(source, target, placement)
  }

  useEffect(() => () => {
    folderDragPreviewRef.current?.remove()
    assetDropTargetRef.current?.classList.remove('drop-target')
    setFolderDropIndicator(folderDropTargetRef.current, null)
  }, [])

  return (
    <aside className="sidebar glass-sidebar">
      <div className="side-scroll">
        <section className="side-sec">
          <div className="side-title"><Icon name="clock" />快捷访问</div>
          <button className={`nav-item${nav === 'all' ? ' on' : ''}`} onClick={() => setNav('all')}>
            <Icon name="layers" />全部素材<span className="cnt">{c.all.toLocaleString('en-US')}</span>
          </button>
          <button className={`nav-item${nav === 'recent' ? ' on' : ''}`} onClick={() => setNav('recent')}>
            <Icon name="clock" />最近导入<span className="cnt">{c.recent}</span>
          </button>
          <button
                className={`nav-item${nav === 'untagged' ? ' on' : ''}`}
            onClick={() => setNav('untagged')}
            onDragOver={(e) => {
              if (!isAssetDrag(e)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setAssetDropTarget(e.currentTarget)
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return
              if (assetDropTargetRef.current === e.currentTarget) setAssetDropTarget(null)
            }}
            onDrop={(e) => moveDrop('', e)}
          >
            <Icon name="inbox" />未分类<span className="cnt">{c.untagged}</span>
          </button>
          <button className={`nav-item${nav === 'fav' ? ' on' : ''}`} onClick={() => setNav('fav')}>
            <Icon name="heart" />收藏<span className="cnt">{c.fav}</span>
          </button>
          <button className={`nav-item${nav === 'trash' ? ' on' : ''}`} onClick={() => setNav('trash')}>
            <Icon name="trash" />回收站<span className="cnt">{c.trash}</span>
          </button>
        </section>

        <section className="side-sec">
          <div className="side-title">
            <span className="side-title-label folder-section-title">素材管理</span>
            {mode === 'library' && (
              <button className="side-title-add" title="新建文件夹" aria-label="新建文件夹" onClick={createFolder}>
                <Icon name="plus" />
              </button>
            )}
          </div>
          {mode === 'library' && (
            <>
              <DirTree
                nodes={dirTree}
                depth={0}
                nav={nav}
                setNav={setNav}
                editingPath={folderEditPath}
                onCommit={renameFolder}
                onCancel={cancelFolderRename}
                collapsedPaths={collapsedPaths}
                onToggleCollapsed={toggleCollapsed}
                onAssetDragOverFolder={setAssetDropTarget}
                onAssetDragLeaveFolder={(element, event) => {
                  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
                  if (assetDropTargetRef.current === element) setAssetDropTarget(null)
                }}
                onAssetDropFolder={moveDrop}
                folderDropRef={folderDropRef}
                folderDragSource={() => folderDragSourceRef.current}
                onFolderDragStart={(path, preview) => {
                  folderDragPreviewRef.current?.remove()
                  folderDragPreviewRef.current = preview
                  folderDragSourceRef.current = path
                  clearFolderDrop()
                }}
                onFolderDragEnd={clearFolderDrag}
                onFolderDragOver={(element, path, placement) => updateFolderDrop(element, { target: path, placement })}
                onFolderDragLeave={(path, event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    if (folderDropRef.current?.target === path) clearFolderDrop()
                  }
                }}
                onFolderDrop={(path, event, placement) => dropFolder(path, event, placement, physicalFolderPaths.includes(path))}
              />
            </>
          )}
        </section>

        <section className="side-sec">
          <div className="side-title"><Icon name="tag" />标签</div>
          {Object.entries(tagStats).map(([name, info]) => {
            const key = `tag:${name}` as const
            return (
              <button key={name} className={`nav-item${nav === key ? ' on' : ''}`} onClick={() => setNav(key)}>
                <span className="dot" style={{ background: info.color }} />
                {name}
                <span className="cnt">{info.n}</span>
              </button>
            )
          })}
          <button className="side-add"><Icon name="edit" />管理标签</button>
        </section>

        <section className="side-sec">
          <div className="side-title"><Icon name="image" />颜色筛选</div>
          <div className="swatches" role="group" aria-label="按颜色筛选">
            <button
              className="sw all"
              title="全部颜色"
              onClick={clearSwatches}
            />
            {SWATCHES.filter((sw) => sw.color).map((sw) => {
              const color = sw.color as string
              const on = swatches.includes(color)
              return (
                <button
                  key={color}
                  className={`sw${on ? ' on' : ''}`}
                  style={{ background: color }}
                  title={sw.title}
                  onClick={() => toggleSwatch(color)}
                />
              )
            })}
          </div>
        </section>
      </div>
    </aside>
  )
}
