import { useUI } from '../store/ui'
import { Icon } from './Icons'

export function Toolbar(): React.JSX.Element {
  const setSearch = useUI((s) => s.setSearch)

  return (
    <div className="toolbar glass-toolbar">
      <div className="nav-arrows">
        <button className="tb-btn" disabled title="后退">
          <Icon name="arr-l" />
        </button>
        <button className="tb-btn" title="前进">
          <Icon name="arr-r" />
        </button>
      </div>
      <div className="tb-main">
        <label className="searchbox">
          <Icon name="search" />
          <input
            type="text"
            placeholder="搜索名称、标签、备注、扩展名…"
            aria-label="搜索素材"
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>Ctrl F</kbd>
        </label>
      </div>
    </div>
  )
}
