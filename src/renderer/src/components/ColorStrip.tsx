import { useMemo } from 'react'
import { useUI } from '../store/ui'
import { aggregatePalette, queryAssets } from '../data/query'

/**
 * 色带:当前视图素材 palette 加权聚合前 8 色(spec close-spec-gaps)。
 * 聚合不含色带自身选中(stripColor),避免自反馈。
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

  const strip = useMemo(
    () => (cbarOpen ? aggregatePalette(queryAssets(assets, { nav, search, filters, swatches, stripColor: null })) : []),
    [cbarOpen, assets, nav, search, filters, swatches]
  )

  if (!cbarOpen) return null
  return (
    <div className="cbar glass-cbar" id="cbar">
      <span className="ct">当前视图 · 颜色构造</span>
      <div className="cstrip">
        {strip.length === 0 ? (
          <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>当前视图无颜色数据(素材缺少调色板)</span>
        ) : (
          strip.map((c) => (
            <button
              key={c.hex}
              className={`cs${stripColor === c.hex ? ' on' : ''}`}
              style={{ background: c.hex }}
              onClick={() => setStripColor(stripColor === c.hex ? null : c.hex)}
            >
              <em>{c.ratio}%</em>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
