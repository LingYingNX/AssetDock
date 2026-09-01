import { useUI } from '../store/ui'
import { COLOR_STRIP } from '../data/dataset'

/** 色带:当前文件夹颜色构造,点选色块即按主色筛选 */
export function ColorStrip(): React.JSX.Element | null {
  const cbarOpen = useUI((s) => s.cbarOpen)
  const stripColor = useUI((s) => s.stripColor)
  const setStripColor = useUI((s) => s.setStripColor)

  if (!cbarOpen) return null
  return (
    <div className="cbar glass-cbar" id="cbar">
      <span className="ct">当前文件夹 · 颜色构造</span>
      <div className="cstrip">
        {COLOR_STRIP.map((c) => (
          <button
            key={c.hex}
            className={`cs${stripColor === c.hex ? ' on' : ''}`}
            style={{ background: c.hex }}
            onClick={() => setStripColor(stripColor === c.hex ? null : c.hex)}
          >
            <em>{c.ratio}%</em>
          </button>
        ))}
      </div>
    </div>
  )
}
