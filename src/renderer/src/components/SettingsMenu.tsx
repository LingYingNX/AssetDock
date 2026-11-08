import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '../store/ui'
import { Icon } from './Icons'
import { useMenuFocus } from './useMenuFocus'

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
  const importAssetFilesFlow = useUI((s) => s.importAssetFilesFlow)
  const importEagleFlow = useUI((s) => s.importEagleFlow)
  const createLibraryFlow = useUI((s) => s.createLibraryFlow)
  const closeTab = useUI((s) => s.closeTab)
  const activeTabId = useUI((s) => s.activeTabId)
  /* 「关闭素材库」只在开了多个库时才有意义:closeTab 对最后一个 tab 直接 return,
     那时它会变成一条点了没反应的死项,不如不给。 */
  const canCloseTab = useUI((s) => s.tabs.length > 1)
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
  useMenuFocus(open && mounted && position != null, menuRef, () => setOpenMenu(null))

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    /* 与 Dropdown 同规则:齿轮菜单被别的浮层顶掉时立即卸载,不叠着淡出。
       真正关回页面(openMenu 为 null)才播退场。 */
    if (useUI.getState().openMenu !== null) {
      setMounted(false)
      return
    }
    const timer = window.setTimeout(() => setMounted(false), 160)
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
      onPointerLeave={() => setOpenMenu(null)}
    >
      {/* 标题栏那颗「+」已移除(它和标签页的「×」一起构成浏览器标签栏的样子),
          新建素材库的入口收在这里。createLibraryFlow 会开文件夹选择器,
          是个模态流程,所以先把菜单收掉。 */}
      <SettingsItem
        icon="cube"
        label="创建资源库"
        onClick={() => {
          setOpenMenu(null)
          void createLibraryFlow()
        }}
      />
      <div className="settings-menu-parent" onMouseEnter={() => setLibraryMenuOpen(true)} onMouseLeave={() => setLibraryMenuOpen(false)}>
        <SettingsItem icon="drive" label="资源库管理" arrow expanded={libraryMenuOpen} onClick={() => setLibraryMenuOpen((value) => !value)} />
        {libraryMenuOpen && (
          <div className="settings-menu settings-menu-submenu glass-menu" role="menu">
            <SettingsItem icon="plus" label="导入素材" onClick={importAssetFilesFlow} />
            <SettingsItem icon="layers" label="导入 Eagle 素材" onClick={importEagleFlow} />
            {canCloseTab && (
              <SettingsItem
                icon="x"
                label="关闭当前素材库"
                onClick={() => {
                  setOpenMenu(null)
                  closeTab(activeTabId)
                }}
              />
            )}
          </div>
        )}
      </div>
      {/* 原来这里有一条 .settings-menu-divider:它自带 5px 上下外边距,悬停
          「偏好设置」时高亮上方会空出一条暗带(与菜单内边距同一个症状)。删掉。 */}
      <SettingsItem icon="gear" label="偏好设置" shortcut="Ctrl+," onClick={() => setOpenMenu('preferences')} />
    </div>,
    document.body
  )
}
