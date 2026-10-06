import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '../store/ui'
import { Icon } from './Icons'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  dotColor?: string
  sub?: string
  disabled?: boolean
  /** 分组分隔:该项之后画分隔线 */
  groupEnd?: boolean
}

interface DropdownProps {
  id: string
  items: MenuItem[]
  value: string
  compact?: boolean
  onPick: (id: string) => void
}

/**
 * 单选下拉菜单:定位到触发按钮下方,宽度按内容收缩。
 * 选中项以左缘蓝条 + 加粗蓝字标识(不用勾选列,避免撑宽菜单)。
 */
export function Dropdown({ id, items, value, compact = false, onPick }: DropdownProps): React.JSX.Element | null {
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const ref = useRef<HTMLDivElement>(null)
  const open = openMenu === id

  /* 三态:open 决定外观,shown 决定是否带 .open,mounted 决定是否留在 DOM。
     原来 `if (!open) return null` 一关就卸载,menu.css 里写的 transition 与
     `.menu.closing` 都无从生效 —— 菜单永远 0ms 硬消失。
     入场不需要额外状态:menu.css 的 `.menu.open` 自带 @starting-style,
     新挂载元素带着 .open 进来时浏览器会自己补起始帧。
     卸载定时器不能省:reduced-motion 下 glass.css 全局移除过渡,transitionend 永不触发。 */
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setShown(true)
      return
    }
    setShown(false)
    const timer = window.setTimeout(() => setMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const el = ref.current
    const btn = document.querySelector(`[data-menu="${id}"]`)
    if (!el || !btn) return
    const r = btn.getBoundingClientRect()
    el.style.top = `${r.bottom + 6}px`
    if (id.startsWith('tab-')) {
      el.style.left = `${r.left}px`
      el.style.right = 'auto'
    } else {
      el.style.left = 'auto'
      el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`
    }
  }, [open, id])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      const trigger = document.querySelector(`[data-menu="${id}"]`)
      if (ref.current?.contains(target) || trigger?.contains(target)) return
      setOpenMenu(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, id, setOpenMenu])

  if (!mounted) return null

  const node = (
    <div ref={ref} className={`menu glass-menu pick-menu${compact ? ' compact-menu' : ''}${id.startsWith('tab-') ? '' : ' menu-anchor-right'}${shown ? ' open' : ' closing'}`} role="menu">
      {items.map((it) => {
        const on = it.id === value
        return (
          <div key={it.id}>
            <button
              className={on ? 'on' : undefined}
              disabled={it.disabled}
              role="menuitemradio"
              aria-checked={on}
              onClick={() => {
                if (it.disabled) return
                onPick(it.id)
                setOpenMenu(null)
              }}
            >
              {it.icon ? <Icon name={it.icon} /> : null}
              {it.dotColor ? <span className="dot" style={{ background: it.dotColor }} /> : null}
              <span className="lbl">{it.label}</span>
              {it.sub ? <span className="sub">{it.sub}</span> : null}
            </button>
            {it.groupEnd ? <div className="sep" /> : null}
          </div>
        )
      })}
    </div>
  )
  return createPortal(node, document.body)
}
