import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { canDropFolder } from '../data/folder-drag'
import { useUI } from '../store/ui'
import { Icon } from './Icons'

interface MoveTarget {
  path: string
  label: string
  hint: string
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
  const subRef = useRef<HTMLDivElement>(null)
  const glowFrame = useRef(0)
  const glowPoint = useRef<{ element: HTMLDivElement; x: number; y: number } | null>(null)

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

  useEffect(() => {
    setSubOpen(false)
  }, [menuKey])

  useEffect(() => () => {
    if (glowFrame.current) cancelAnimationFrame(glowFrame.current)
  }, [])

  const targets = useMemo<MoveTarget[]>(() => {
    if (!path) return []
    const root = canDropFolder(path, '', 'inside', true)
      ? [{ path: '', label: '库根目录', hint: '素材库根目录' }]
      : []
    return [
      ...root,
      ...folderPaths
        .filter((target) => canDropFolder(path, target, 'inside', true))
        .map((target) => ({
          path: target,
          label: target.split('/').pop() ?? target,
          hint: target.includes('/') ? target : ''
        }))
    ]
  }, [folderPaths, path])

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

  useLayoutEffect(() => {
    const submenu = subRef.current
    if (!submenu) return
    const row = submenu.parentElement?.getBoundingClientRect()
    if (!row) return
    const margin = 8
    const height = submenu.offsetHeight
    const desiredTop = row.top - 5
    const clampedTop = Math.max(margin, Math.min(desiredTop, window.innerHeight - height - margin))
    submenu.style.top = `${clampedTop - row.top}px`
    submenu.classList.toggle('has-more', submenu.scrollHeight > submenu.clientHeight + 1)
    const width = submenu.offsetWidth
    submenu.classList.toggle('flip-x', row.right + 3 + width > window.innerWidth - margin)
  }, [subOpen, pos])

  if (!mounted || !menu) return null

  const close = (): void => setFolderCtxMenu(null)
  const act = (run: () => void): void => {
    close()
    run()
  }
  const openSource = (): void => {
    void window.windowApi.folders.open(menu.libraryId, menu.path).then((result) => {
      if ('error' in result) showToast(result.error, 'warn')
    }).catch(() => showToast('无法打开源目录', 'warn'))
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
        className={`menu glass-menu folder-menu${folderCtxMenu ? ' open' : ' closing'}`}
        style={{
          top: pos?.top ?? menu.y,
          left: pos?.left ?? menu.x,
          visibility: pos ? 'visible' : 'hidden'
        }}
        role="menu"
        aria-label={`文件夹「${menu.path.split('/').pop() ?? menu.path}」菜单`}
        onClick={(event) => event.stopPropagation()}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse') return
          glowPoint.current = {
            element: event.currentTarget,
            x: event.clientX,
            y: event.clientY
          }
          if (glowFrame.current) return
          glowFrame.current = requestAnimationFrame(() => {
            glowFrame.current = 0
            const point = glowPoint.current
            if (!point) return
            const rect = point.element.getBoundingClientRect()
            point.element.style.setProperty('--menu-glow-x', `${point.x - rect.left}px`)
            point.element.style.setProperty('--menu-glow-y', `${point.y - rect.top}px`)
          })
        }}
      >
        <ul className="folder-menu-group" role="group">
          <li>
            <button
              type="button"
              role="menuitem"
              onMouseEnter={() => setSubOpen(false)}
              onClick={() => act(() => createFolder(menu.path))}
            >
              <span className="folder-menu-icon"><Icon name="folder-plus" /></span>
              <span className="folder-menu-label">新增子文件夹</span>
            </button>
          </li>
          <li className="menu-row folder-menu-move-row" onMouseEnter={() => setSubOpen(true)}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={subOpen}
              disabled={targets.length === 0}
              onClick={() => setSubOpen((open) => !open)}
            >
              <span className="folder-menu-icon"><Icon name="arr-r" /></span>
              <span className="folder-menu-label">移动</span>
              <Icon name="chev-r" className="sub" />
            </button>
            {subOpen ? (
              <div ref={subRef} className="menu glass-menu open submenu folder-menu-submenu" role="menu">
                {targets.length === 0 ? <div className="menu-empty">没有可移动到的文件夹</div> : null}
                {targets.map((target, index) => (
                  <button
                    key={target.path || '__root'}
                    type="button"
                    role="menuitem"
                    style={{ '--item-index': index } as React.CSSProperties}
                    onClick={() => act(() => moveFolder(menu.path, target.path, 'inside'))}
                  >
                    <span className="folder-menu-target-icon"><Icon name={target.path ? 'folder' : 'layers'} /></span>
                    <span className="folder-menu-label">{target.label}</span>
                    <span className="sub">{target.hint}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </li>
          <li>
            <button
              type="button"
              role="menuitem"
              onMouseEnter={() => setSubOpen(false)}
              onClick={() => act(() => beginFolderRename(menu.path))}
            >
              <span className="folder-menu-icon"><Icon name="edit" /></span>
              <span className="folder-menu-label">重命名</span>
              <span className="k">F2</span>
            </button>
          </li>
        </ul>

        <div className="folder-menu-sep" />

        <ul className="folder-menu-group" role="group">
          <li>
            <button
              type="button"
              role="menuitem"
              onMouseEnter={() => setSubOpen(false)}
              onClick={() => act(openSource)}
            >
              <span className="folder-menu-icon"><Icon name="external" /></span>
              <span className="folder-menu-label">源目录</span>
            </button>
          </li>
        </ul>

        <div className="folder-menu-sep" />

        <ul className="folder-menu-group" role="group">
          <li className="danger">
            <button
              type="button"
              role="menuitem"
              onMouseEnter={() => setSubOpen(false)}
              onClick={() => act(() => trashFolder(menu.path))}
            >
              <span className="folder-menu-icon"><Icon name="trash" /></span>
              <span className="folder-menu-label">删除</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  )
}
