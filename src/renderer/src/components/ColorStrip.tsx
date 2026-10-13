import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '../store/ui'
import { aggregatePalette, queryAssets } from '../data/query'

/**
 * 颜色构造:当前视图素材 palette 加权聚合前 8 色。
 * 以浮层下拉呈现,不再占据筛选条下方的整条横向空间。
 * 聚合不含自身选中(stripColor),避免自反馈。
 */
export function ColorStrip(): React.JSX.Element | null {
  const cbarOpen = useUI((s) => s.cbarOpen)
  const stripColor = useUI((s) => s.stripColor)
  const setStripColor = useUI((s) => s.setStripColor)
  const assets = useUI((s) => s.assets)
  const nav = useUI((s) => s.nav)
  const search = useUI((s) => s.search)
  const filters = useUI((s) => s.filters)
  const swatches = useUI((s) => s.swatches)
  const ref = useRef<HTMLDivElement>(null)

  const strip = useMemo(
    () => (cbarOpen ? aggregatePalette(queryAssets(assets, { nav, search, filters, swatches, stripColor: null })) : []),
    [cbarOpen, assets, nav, search, filters, swatches]
  )

  /* 三态:open 决定外观,shown 决定是否带 .open,mounted 决定是否留在 DOM。
     原来 `if (!cbarOpen) return null` 一关就卸载,menu.css 里 `.menu` 的 transition
     与 `.menu.closing` 都无从生效 —— 浮层永远 0ms 硬消失。
     入场不需要额外状态:`.menu.open` 自带 @starting-style,挂载首帧就已带 .open。
     卸载定时器不能省:reduced-motion 下 glass.css 全局移除过渡,transitionend 永不触发。 */
  const [mounted, setMounted] = useState(cbarOpen)
  const [shown, setShown] = useState(cbarOpen)

  /* 退场期间 cbarOpen 已是 false,strip 会立刻算成空数组,浮层会在淡出时
     把内容换成「无颜色数据」—— 与 ThumbProgress 退场抽空文案是同一类问题。
     留住最后一次非空结果,只在退场期间改用它;展开状态下始终用实时结果,
     否则换到没有调色板的视图再打开会显示上一次的旧颜色。 */
  const [lastStrip, setLastStrip] = useState(strip)
  useEffect(() => {
    if (cbarOpen && strip.length > 0) setLastStrip(strip)
  }, [cbarOpen, strip])

  useEffect(() => {
    if (cbarOpen) {
      setMounted(true)
      setShown(true)
      return
    }
    /* 同 Dropdown:焦点被下拉菜单抢走时立即卸载,避免两块浮层叠着一起淡出。
       setOpenMenu 会把 cbarOpen 置 false,所以这种切换读到的 openMenu 非空。 */
    if (useUI.getState().openMenu !== null) {
      setShown(false)
      setMounted(false)
      return
    }
    setShown(false)
    const timer = window.setTimeout(() => setMounted(false), 160)
    return () => window.clearTimeout(timer)
  }, [cbarOpen])

  /* 定位要等元素真的挂上。三态里 mounted 比 cbarOpen 晚一帧:打开的那次渲染
     mounted 仍是 false,组件 return null;而依赖 [cbarOpen] 此刻已经落定,
     等元素出现后不会再跑 —— 浮层带着 position:fixed 却没有 top/left,
     掉到 body 末尾的静态位置(实测 [0,860],视口正下方),看起来像没反应。
     把 mounted 放进依赖,并保留 useLayoutEffect,让定位在绘制前写完内联样式。 */
  useLayoutEffect(() => {
    if (!cbarOpen || !mounted) return
    const el = ref.current
    const btn = document.getElementById('colorBtn')
    if (!el || !btn) return
    const r = btn.getBoundingClientRect()
    el.style.top = `${r.bottom + 6}px`
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`
  }, [cbarOpen, mounted])

  useEffect(() => {
    if (!cbarOpen) return
    const close = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target) || document.getElementById('colorBtn')?.contains(target)) return
      useUI.getState().toggleCbar()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') useUI.getState().toggleCbar()
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [cbarOpen])

  if (!mounted) return null

  const cell = strip.length > 0 ? strip : lastStrip

  const node = (
    <div
      ref={ref}
      className={`menu glass-menu pick-menu color-menu${shown ? ' open' : ' closing'}`}
      id="cbar"
      role="menu"
      aria-label="颜色构造"
    >
      <div className="color-menu-head">颜色构造</div>
      {cell.length === 0 ? (
        <div className="menu-empty">当前视图无颜色数据</div>
      ) : (
        <div className="color-grid">
          {cell.map((c) => (
            <button
              key={c.hex}
              className={`cs${stripColor === c.hex ? ' on' : ''}`}
              style={{ background: c.hex }}
              title={c.hex}
              aria-pressed={stripColor === c.hex}
              onClick={() => setStripColor(stripColor === c.hex ? null : c.hex)}
            >
              <em>{c.ratio}%</em>
            </button>
          ))}
        </div>
      )}
      {stripColor ? (
        <button className="color-menu-clear" onClick={() => setStripColor(null)}>清除颜色筛选</button>
      ) : null}
    </div>
  )
  return createPortal(node, document.body)
}