import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '../store/ui'
import { Icon } from './Icons'

interface MenuPosition {
  top: number
  left: number
}

function SettingsItem({
  icon,
  label,
  arrow,
  shortcut,
  expanded,
  onClick
}: {
  icon: string
  label: string
  arrow?: boolean
  shortcut?: string
  expanded?: boolean
  onClick?: () => void
}): React.JSX.Element {
  const content = (
    <>
      <span className="settings-menu-icon"><Icon name={icon} /></span>
      <span className="settings-menu-label">{label}</span>
      {shortcut ? <span className="settings-menu-shortcut">{shortcut}</span> : null}
      {arrow ? <Icon name="chev-r" className="settings-menu-arrow" /> : null}
    </>
  )
  return (
    onClick ? <button type="button" className="settings-menu-item" role="menuitem" aria-haspopup={arrow ? 'menu' : undefined} aria-expanded={expanded} onClick={onClick}>{content}</button>
      : <div className="settings-menu-item" role="menuitem">{content}</div>
  )
}

export function SettingsMenu(): React.JSX.Element | null {
  const open = useUI((s) => s.openMenu === 'settings')
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const importEagleFlow = useUI((s) => s.importEagleFlow)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false)

  /* 三态:open 决定外观,mounted 决定是否留在 DOM。
     原来 `if (!open || !position) return null` 一关就卸载,menu.css 里
     `.settings-menu` 写的 transition 与 @starting-style 都播不出来。
     位置(position)要保留到退场结束:置空会连 style 里的 top/left 一起消失,
     菜单会在淡出的同时跳到左上角。
     卸载定时器不能省:reduced-motion 下 glass.css 全局移除过渡,transitionend 永不触发。 */
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      // 只收起子菜单:position 必须留到退场结束,否则菜单会边淡出边跳到左上角
      setLibraryMenuOpen(false)
      return
    }
    const trigger = document.querySelector<HTMLElement>('[data-menu="settings"]')
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    setPosition({
      top: rect.bottom + 8,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 192))
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      const trigger = document.querySelector<HTMLElement>('[data-menu="settings"]')
      if (!menuRef.current?.contains(target) && !trigger?.contains(target)) setOpenMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, setOpenMenu])

  if (!mounted || !position) return null

  return createPortal(
    <div
      ref={menuRef}
      className={`settings-menu glass-menu${open ? ' show' : ' closing'}`}
      role="menu"
      style={{ top: position.top, left: position.left }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <SettingsItem icon="cube" label="创建资源库" />
      <div className="settings-menu-parent" onMouseEnter={() => setLibraryMenuOpen(true)} onMouseLeave={() => setLibraryMenuOpen(false)}>
        <SettingsItem icon="drive" label="资源库管理" arrow expanded={libraryMenuOpen} onClick={() => setLibraryMenuOpen((value) => !value)} />
        {libraryMenuOpen && (
          <div className="settings-menu settings-menu-submenu glass-menu" role="menu">
            <SettingsItem icon="layers" label="导入 Eagle 素材" onClick={importEagleFlow} />
          </div>
        )}
      </div>
      <div className="settings-menu-divider" />
      <SettingsItem icon="gear" label="偏好设置" shortcut="Ctrl+," onClick={() => setOpenMenu('preferences')} />
    </div>,
    document.body
  )
}
