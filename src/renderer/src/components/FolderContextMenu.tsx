import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { canDropFolder } from '../data/folder-drag'
import { useUI } from '../store/ui'
import { Icon } from './Icons'
import { useMenuFocus } from './useMenuFocus'

interface MoveNode {
  path: string
  label: string
  selectable: boolean
  children: MoveNode[]
}

function buildMoveTree(paths: string[], source: string): MoveNode {
  const root: MoveNode = { path: '', label: '库根目录', selectable: false, children: [] }
  const byPath = new Map<string, MoveNode>([['', root]])
  for (const item of paths) {
    const cut = item.lastIndexOf('/')
    const node: MoveNode = {
      path: item,
      label: cut < 0 ? item : item.slice(cut + 1),
      selectable: canDropFolder(source, item, 'inside', true),
      children: []
    }
    byPath.set(item, node)
    ;(byPath.get(cut < 0 ? '' : item.slice(0, cut)) ?? root).children.push(node)
  }
  const prune = (node: MoveNode): MoveNode | null => {
    if (node.path === source || node.path.startsWith(`${source}/`)) return null
    const children = node.children.map(prune).filter((child): child is MoveNode => child != null)
    if (!node.selectable && children.length === 0) return null
    return { ...node, children }
  }
  return prune(root) ?? { ...root, children: [] }
}

/** 多级移动菜单:悬停展开子级,点击文件夹直接移入。 */
function MoveLevel({
  node,
  onPick,
  anchor
}: {
  node: MoveNode
  onPick: (path: string) => void
  anchor?: HTMLElement | null
}): React.JSX.Element {
  const [open, setOpen] = useState<{ path: string; anchor: HTMLElement } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const nested = anchor != null

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const margin = 8
    menu.classList.toggle('has-more', menu.scrollHeight > menu.clientHeight + 1)
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    if (!nested) {
      const row = menu.parentElement?.getBoundingClientRect()
      if (!row) return
      const top = Math.max(margin, Math.min(row.top - 5, window.innerHeight - height - margin))
      menu.style.top = `${top - row.top}px`
      menu.classList.toggle('flip-x', row.right + 3 + width > window.innerWidth - margin)
      return
    }
    const row = anchor.getBoundingClientRect()
    const flip = row.right + 3 + width > window.innerWidth - margin
    setPos({
      left: flip ? row.left - 3 - width : row.right + 3,
      top: Math.max(margin, Math.min(row.top - 5, window.innerHeight - height - margin))
    })
  }, [anchor, nested])

  const content = (
    <>
      {node.children.map((child) => (
        <div
          key={child.path}
          className="menu-row"
          onMouseEnter={(event) => setOpen({ path: child.path, anchor: event.currentTarget })}
        >
          <button
            type="button"
            role="menuitem"
            title={child.children.length > 0 ? '点击移入，悬停展开子文件夹' : undefined}
            aria-haspopup={child.children.length > 0 ? 'menu' : undefined}
            aria-expanded={child.children.length > 0 ? open?.path === child.path : undefined}
            onFocus={(event) =>
              setOpen(child.children.length > 0 ? { path: child.path, anchor: event.currentTarget.parentElement as HTMLElement } : null)
            }
            onClick={(event) => {
              if (child.selectable) {
                onPick(child.path)
                return
              }
              const row = event.currentTarget.parentElement as HTMLElement
              setOpen((value) => (value?.path === child.path ? null : { path: child.path, anchor: row }))
            }}
          >
            {child.label}
            {child.children.length > 0 ? <Icon name="chev-r" className="ic sub" /> : null}
          </button>
          {open?.path === child.path && child.children.length > 0 ? (
            <MoveLevel node={child} onPick={onPick} anchor={open.anchor} />
          ) : null}
        </div>
      ))}
      {node.children.length === 0 ? <div className="menu-empty">没有可移动到的文件夹</div> : null}
    </>
  )

  if (nested) {
    return createPortal(
      <div
        ref={ref}
        className="menu glass-menu open folder-move-popup"
        role="menu"
        style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      >
        {content}
      </div>,
      document.body
    )
  }

  return (
    <div ref={ref} className="menu glass-menu open submenu folder-move-menu" role="menu">
      {content}
    </div>
  )
}

/** 文件夹右键菜单:分组列表、层级移动子菜单与屏边翻转。 */
export function FolderContextMenu(): React.JSX.Element | null {
  const folderCtxMenu = useUI((s) => s.folderCtxMenu)
  const setFolderCtxMenu = useUI((s) => s.setFolderCtxMenu)
  const createFolder = useUI((s) => s.createFolder)
  const moveFolder = useUI((s) => s.moveFolder)
  const beginFolderRename = useUI((s) => s.beginFolderRename)
  const trashFolder = useUI((s) => s.trashFolder)
  const folderPaths = useUI((s) => s.folderPaths)
  const showToast = useUI((s) => s.showToast)

  const [mounted, setMounted] = useState(folderCtxMenu != null)
  const [last, setLast] = useState(folderCtxMenu)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [subOpen, setSubOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (folderCtxMenu) {
      setLast(folderCtxMenu)
      setMounted(true)
      return
    }
    if (!mounted) return
    const timer = window.setTimeout(() => setMounted(false), 160)
    return () => window.clearTimeout(timer)
  }, [folderCtxMenu, mounted])

  const menu = folderCtxMenu ?? last
  const path = menu?.path ?? ''
  const menuKey = folderCtxMenu ? `${folderCtxMenu.libraryId}:${path}:${folderCtxMenu.x}:${folderCtxMenu.y}` : ''
  useMenuFocus(
    folderCtxMenu != null && mounted,
    menuRef,
    () => setFolderCtxMenu(null),
    'menu',
    () => document.querySelector<HTMLElement>(`[data-folder-path="${CSS.escape(path)}"] .folder-main`)
  )

  useEffect(() => {
    setSubOpen(false)
  }, [menuKey])

  const moveRoot = useMemo(() => buildMoveTree(folderPaths, path), [folderPaths, path])

  useLayoutEffect(() => {
    const element = menuRef.current
    if (!mounted || !element || !folderCtxMenu) return
    // 入口缩放会让 rect 小于最终尺寸，屏边定位必须用布局尺寸。
    const width = element.offsetWidth
    const height = element.offsetHeight
    const margin = 8
    const top = Math.max(margin, Math.min(folderCtxMenu.y, window.innerHeight - height - margin))
    const left = Math.max(margin, Math.min(folderCtxMenu.x, window.innerWidth - width - margin))
    element.style.transformOrigin =
      `${Math.max(6, Math.min(folderCtxMenu.x - left, width - 6))}px ` +
      `${Math.max(6, Math.min(folderCtxMenu.y - top, height - 6))}px`
    setPos({ top, left })
  }, [menuKey, mounted])

  if (!mounted || !menu) return null

  const close = (): void => setFolderCtxMenu(null)
  const act = (run: () => void): void => {
    close()
    run()
  }
  const openSource = (): void => {
    void window.windowApi.folders.open(menu.libraryId, menu.path).then((result) => {
      if ('error' in result) showToast(result.error, 'warn')
    }).catch(() => showToast('无法在资源管理器中显示', 'warn'))
  }

  return (
    <div
      className="folder-menu-overlay"
      style={{ pointerEvents: folderCtxMenu ? 'auto' : 'none' }}
      onClick={close}
      onContextMenu={(event) => {
        event.preventDefault()
        close()
        const overlay = event.currentTarget
        const previous = overlay.style.pointerEvents
        overlay.style.pointerEvents = 'none'
        const hit = document.elementFromPoint(event.clientX, event.clientY)
        overlay.style.pointerEvents = previous
        if (!hit || overlay.contains(hit)) return
        hit.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: event.clientX,
          clientY: event.clientY
        }))
      }}
    >
      <div
        ref={menuRef}
        className={`menu glass-menu ctx-menu${folderCtxMenu ? ' open' : ' closing'}`}
        style={{
          top: pos?.top ?? menu.y,
          left: pos?.left ?? menu.x,
          visibility: pos ? 'visible' : 'hidden'
        }}
        role="menu"
        aria-label={`文件夹「${menu.path.split('/').pop() ?? menu.path}」菜单`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          onMouseEnter={() => setSubOpen(false)}
          onClick={() => act(() => createFolder(menu.path))}
        >
          <Icon name="folder-plus" />
          新增子文件夹
        </button>
        <div className="menu-row" onMouseEnter={() => setSubOpen(true)}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={subOpen}
            disabled={moveRoot.children.length === 0}
            onFocus={() => setSubOpen(true)}
            onClick={() => setSubOpen((open) => !open)}
          >
            <Icon name="folder" />
            移动
            <Icon name="chev-r" className="ic sub" />
          </button>
          {subOpen ? (
            <MoveLevel node={moveRoot} onPick={(target) => act(() => moveFolder(menu.path, target, 'inside'))} />
          ) : null}
        </div>
        <button
          type="button"
          role="menuitem"
          onMouseEnter={() => setSubOpen(false)}
          onClick={() => act(() => beginFolderRename(menu.path))}
        >
          <Icon name="edit" />
          重命名
          <span className="k">F2</span>
        </button>

        <div className="sep" />

        <button
          type="button"
          role="menuitem"
          onMouseEnter={() => setSubOpen(false)}
          onClick={() => act(openSource)}
        >
          <Icon name="external" />
          在资源管理器中显示
        </button>

        <div className="sep" />

        <div className="danger">
          <button
            type="button"
            role="menuitem"
            onMouseEnter={() => setSubOpen(false)}
            onClick={() => act(() => trashFolder(menu.path))}
          >
            <Icon name="trash" />
            删除
          </button>
        </div>
      </div>
    </div>
  )
}
