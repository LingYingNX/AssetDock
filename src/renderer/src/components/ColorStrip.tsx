import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
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

  useLayoutEffect(() => {
    if (!cbarOpen) return
    const el = ref.current
    const btn = document.getElementById('colorBtn')
    if (!el || !btn) return
    const r = btn.getBoundingClientRect()
    el.style.top = `${r.bottom + 6}px`
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`
  }, [cbarOpen])

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

  if (!cbarOpen) return null

  const node = (
    <div ref={ref} className="menu glass-menu open pick-menu color-menu" id="cbar" role="menu" aria-label="颜色构造">
      <div className="color-menu-head">颜色构造</div>
      {strip.length === 0 ? (
        <div className="menu-empty">当前视图无颜色数据(素材缺少调色板)</div>
      ) : (
        <div className="color-grid">
          {strip.map((c) => (
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