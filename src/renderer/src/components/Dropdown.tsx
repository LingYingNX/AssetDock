import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '../store/ui'
import { Icon } from './Icons'
import { useMenuFocus } from './useMenuFocus'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  dotColor?: string
  sub?: string
  disabled?: boolean
  /** 分组分隔:该项之后画分隔线 */
  groupEnd?: boolean
  /** 分组标题:渲染在每一项之前,不可点。用于把一段平铺的同类项按类目切开,
      例如格式下拉的「图片 / 视频 / 三维」。 */
  heading?: string
  /** 可折叠分组标题:提供 onToggleGroup 后标题变成按钮,groupOpen 决定箭头方向与子项是否渲染 */
  groupOpen?: boolean
  onToggleGroup?: () => void
}

interface DropdownProps {
  id: string
  items: MenuItem[]
  value: string
  compact?: boolean
  onPick: (id: string) => void
  /** 悬停打开的菜单:指针进入面板时取消触发器的延迟关闭 */
  onPointerEnter?: () => void
}

/**
 * 单选下拉菜单:定位到触发按钮下方,宽度按内容收缩。
 * 选中项以左缘蓝条 + 加粗蓝字标识(不用勾选列,避免撑宽菜单)。
 */
export function Dropdown({ id, items, value, compact = false, onPick, onPointerEnter }: DropdownProps): React.JSX.Element | null {
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
  useMenuFocus(open && mounted, ref, () => setOpenMenu(null))

  useEffect(() => {
    if (open) {
      setMounted(true)
      setShown(true)
      return
    }
    /* 被别的浮层抢走焦点时直接卸载,不播退场:新菜单会盖在同一片区域上,
       旧面板再淡出 140ms 只会留下两块半透明叠影(实测切换瞬间 DOM 里同时存在
       .open 与 .closing 两块面板,旧的在 x=451、新的在 x=372,视觉就是鬼影交叉)。
       只有真正关回页面(没有任何浮层打开)时,才值得播一次干净的退出。 */
    if (useUI.getState().openMenu !== null) {
      setShown(false)
      setMounted(false)
      return
    }
    setShown(false)
    const timer = window.setTimeout(() => setMounted(false), 160)
    return () => window.clearTimeout(timer)
  }, [open])

  /* 定位必须等元素真的挂上。三态让 mounted 比 open 晚一帧:open 变 true 的那次渲染
     mounted 仍是 false,组件 return null,ref.current 为 null;而本 effect 的依赖
     [open, id] 此刻已经落定,等 mounted 跟上后不会再跑一次 —— 菜单带着 position:fixed
     却没有任何 top/left,掉进 body 末尾的静态位置(实测 [0,860],正好在视口下方),
     表现为「点了没反应」。
     改成 useLayoutEffect 并把 mounted 放进依赖:元素挂上后再量,且在绘制前写完内联定位,
     不会先闪一帧到错误位置。 */
  useLayoutEffect(() => {
    if (!open || !mounted) return
    const el = ref.current
    const btn = document.querySelector(`[data-menu="${id}"]`)
    if (!el || !btn) return
    const r = btn.getBoundingClientRect()
    el.style.top = `${r.bottom + 6}px`
    if (id.startsWith('tab-')) {
      el.style.left = `${r.left}px`
      el.style.right = 'auto'
      el.style.transformOrigin = 'top left'
    } else {
      /* 筛选/视图下拉从触发按钮左缘向右展开;原来右缘对齐会让菜单盒向左
         盖住相邻按钮。右侧放不下时翻回右缘对齐,避免溢出视口。 */
      if (r.left + el.offsetWidth > window.innerWidth - 8) {
        el.style.left = 'auto'
        el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`
        el.style.transformOrigin = 'top right'
      } else {
        el.style.left = `${r.left}px`
        el.style.right = 'auto'
        el.style.transformOrigin = 'top left'
      }
    }
  }, [open, mounted, id])

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
    <div
      ref={ref}
      className={`menu glass-menu pick-menu${compact ? ' compact-menu' : ''}${id.startsWith('tab-') ? '' : ' menu-filter'}${shown ? ' open' : ' closing'}`}
      role="menu"
      onPointerEnter={onPointerEnter}
      onPointerLeave={() => setOpenMenu(null)}
    >
      {items.map((it) => {
        const on = it.id === value
        if (it.onToggleGroup) {
          return (
            <button
              key={it.id}
              type="button"
              className="menu-fold"
              aria-expanded={it.groupOpen}
              onClick={it.onToggleGroup}
            >
              <Icon name="chev-r" className={it.groupOpen ? 'open' : undefined} />
              <span>{it.heading}</span>
            </button>
          )
        }
        return (
          <div key={it.id}>
            {it.heading ? <div className="menu-head">{it.heading}</div> : null}
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
