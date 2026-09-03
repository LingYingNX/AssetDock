import { useEffect, useRef } from 'react'
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

/** 单选下拉菜单:定位到触发按钮下方 */
export function Dropdown({ id, items, value, compact = false, onPick }: DropdownProps): React.JSX.Element | null {
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const ref = useRef<HTMLDivElement>(null)
  const open = openMenu === id

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
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open, id, setOpenMenu])

  if (!open) return null

  const node = (
    <div ref={ref} className={`menu glass-menu open${compact ? ' compact-menu' : ''}`} role="menu">
      {items.map((it) => (
        <div key={it.id}>
          <button
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return
              onPick(it.id)
              setOpenMenu(null)
            }}
          >
            {(!compact || value) ? <span className="ck">{it.id === value ? <Icon name="check" /> : null}</span> : null}
            {it.icon ? <Icon name={it.icon} /> : null}
            {it.dotColor ? <span className="dot" style={{ background: it.dotColor }} /> : null}
            {it.label}
            {it.sub ? <span className="sub">{it.sub}</span> : null}
          </button>
          {it.groupEnd ? <div className="sep" /> : null}
        </div>
      ))}
    </div>
  )
  return createPortal(node, document.body)
}
