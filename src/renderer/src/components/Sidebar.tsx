import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { SWATCHES } from '../data/dataset'
import { sidebarCounts } from '../data/query'
import { MEDIA_ASSETS_DRAG_TYPE, decodeAssetDrag, isAssetDrag } from '../data/asset-drag'
import { Icon } from './Icons'

interface DirNode {
  path: string
  label: string
  count: number
  children: DirNode[]
}

/** 库模式:只用真实目录建树,素材路径仅用于节点计数 */
function buildDirTree(paths: string[], assets: { folders: string[]; missing?: boolean; deletedAt?: string }[]): DirNode[] {
  const counts = new Map<string, number>()
  for (const a of assets) {
    if (a.missing || a.deletedAt) continue
    for (const f of a.folders) counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  return buildTree(paths, counts)
}

function buildTree(paths: string[], counts: Map<string, number>): DirNode[] {
  const root: DirNode[] = []
  const byPath = new Map<string, DirNode>()
  for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
    const segs = path.split('/')
    const label = segs[segs.length - 1]
    const node: DirNode = { path, label, count: counts.get(path) ?? 0, children: [] }
    byPath.set(path, node)
    if (segs.length === 1) root.push(node)
    else {
      const parent = byPath.get(segs.slice(0, -1).join('/'))
      if (parent) parent.children.push(node)
      else root.push(node) // 父目录缺数据时兜底挂根
    }
  }
  return root
}

function FolderNameEditor({ name, onCommit, onCancel }: { name: string; onCommit: (name: string) => void; onCancel: () => void }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(name)
  const cancelled = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  useEffect(() => {
    const commitOutside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) ref.current?.blur()
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
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (!cancelled.current) onCommit(value)
      }}
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
  dropTargetPath,
  onDragEnterFolder,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropFolder
}: {
  nodes: DirNode[]
  depth: number
  nav: string
  setNav: (n: never) => void
  editingPath: string | null
  onCommit: (path: string, name: string) => void
  onCancel: () => void
  dropTargetPath: string | null
  onDragEnterFolder: (path: string) => void
  onDragOverFolder: (path: string) => void
  onDragLeaveFolder: (path: string, event: React.DragEvent<HTMLDivElement>) => void
  onDropFolder: (path: string, event: React.DragEvent<HTMLDivElement>) => void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((n) => {
        const key = `folder:${n.path}`
        const on = nav === key
        const dropping = dropTargetPath === n.path
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
                className={`nav-item folder-row${on ? ' on' : ''}${dropping ? ' drop-target' : ''}`}
                style={{ paddingLeft: 10 + depth * 14 }}
                onDragEnter={() => onDragEnterFolder(n.path)}
                onDragOver={(e) => {
                  if (!isAssetDrag(e)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  onDragOverFolder(n.path)
                }}
                onDragLeave={(e) => onDragLeaveFolder(n.path, e)}
                onDrop={(e) => onDropFolder(n.path, e)}
                data-folder-path={n.path}
              >
                <button className="folder-main" onClick={() => setNav(key as never)} title={n.label}>
                  <Icon name="folder" />
                  <span className="folder-label">{n.label}</span>
                  <span className="cnt">{n.count}</span>
                </button>
              </div>
            )}
            {n.children.length > 0 && (
              <DirTree
                nodes={n.children}
                depth={depth + 1}
                nav={nav}
                setNav={setNav}
                editingPath={editingPath}
                onCommit={onCommit}
                onCancel={onCancel}
                dropTargetPath={dropTargetPath}
                onDragEnterFolder={onDragEnterFolder}
                onDragOverFolder={onDragOverFolder}
                onDragLeaveFolder={onDragLeaveFolder}
                onDropFolder={onDropFolder}
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
  const folderEditPath = useUI((s) => s.folderEditPath)
  const createFolder = useUI((s) => s.createFolder)
  const renameFolder = useUI((s) => s.renameFolder)
  const cancelFolderRename = useUI((s) => s.cancelFolderRename)
  const moveAssetsToFolder = useUI((s) => s.moveAssetsToFolder)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const c = sidebarCounts(assets)
  const tagStats = assets.reduce<Record<string, { color: string; n: number }>>((acc, a) => {
    if (a.missing || a.deletedAt) return acc
    for (const t of a.tags) {
      acc[t.name] = acc[t.name] ?? { color: t.color, n: 0 }
      acc[t.name].n++
    }
    return acc
  }, {})

  const dirTree = mode === 'library' ? buildDirTree(folderPaths, assets) : []

  const moveDrop = (folder: string, event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setDropTargetPath(null)
    const encoded = event.dataTransfer.getData(MEDIA_ASSETS_DRAG_TYPE) || event.dataTransfer.getData('text/plain')
    const assetIds = decodeAssetDrag(encoded)
    if (assetIds.length > 0) moveAssetsToFolder(assetIds, folder)
  }

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
            className={`nav-item${nav === 'untagged' ? ' on' : ''}${dropTargetPath === '' ? ' drop-target' : ''}`}
            onClick={() => setNav('untagged')}
            onDragOver={(e) => {
              if (!isAssetDrag(e)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropTargetPath('')
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return
              setDropTargetPath((current) => (current === '' ? null : current))
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
            <span className="side-title-label"><Icon name="folder" />文件夹</span>
            {mode === 'library' && (
              <button className="side-title-add" title="新建文件夹" aria-label="新建文件夹" onClick={createFolder}>
                <Icon name="plus" />
              </button>
            )}
          </div>
          {mode === 'library' && (
            <DirTree
              nodes={dirTree}
              depth={0}
              nav={nav}
              setNav={setNav}
              editingPath={folderEditPath}
              onCommit={renameFolder}
              onCancel={cancelFolderRename}
              dropTargetPath={dropTargetPath}
              onDragEnterFolder={setDropTargetPath}
              onDragOverFolder={setDropTargetPath}
              onDragLeaveFolder={(path, event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
                setDropTargetPath((current) => (current === path ? null : current))
              }}
              onDropFolder={moveDrop}
            />
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
