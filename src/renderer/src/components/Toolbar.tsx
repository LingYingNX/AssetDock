import { useUI } from '../store/ui'
import { Icon } from './Icons'

export function Toolbar(): React.JSX.Element {
  const search = useUI((s) => s.search)
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
          {/* 受控输入框:空结果态的「清空搜索」、Esc、切换库标签都会改写关键词,
              输入框必须跟着走,不能停在已经失效的旧文本上。 */}
          <input
            type="text"
            value={search}
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
