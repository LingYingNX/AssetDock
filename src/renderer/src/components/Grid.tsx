import { useUI } from '../store/ui'
import { queryAssets } from '../data/query'
import { Card } from './Card'
import { Icon } from './Icons'

const LHEAD_COLS = ['', '文件名', '类型', '分辨率', '大小', '时长', '导入时间', '']

export function Grid(): React.JSX.Element {
  const view = useUI((s) => s.view)
  const assets = useUI((s) => s.assets)
  const nav = useUI((s) => s.nav)
  const search = useUI((s) => s.search)
  const filters = useUI((s) => s.filters)
  const swatches = useUI((s) => s.swatches)
  const stripColor = useUI((s) => s.stripColor)
  const clearSelection = useUI((s) => s.clearSelection)
  const setSearch = useUI((s) => s.setSearch)

  const list = queryAssets(assets, { nav, search, filters, swatches, stripColor })

  if (list.length === 0) {
    return (
      <div className="gridwrap">
        <div className="empty">
          <Icon name="image" />
          <span>没有符合当前筛选条件的素材</span>
          <button
            className="btn-clear"
            onClick={() => {
              clearSelection()
              setSearch('')
            }}
          >
            清空搜索
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="gridwrap" id="gridwrap">
      <div className={`grid v-${view}`} id="grid">
        {view === 'list' && (
          <div className="lhead">
            {LHEAD_COLS.map((h, i) => (
              <span key={i}>{h}</span>
            ))}
          </div>
        )}
        {list.map((a) => (
          <Card key={a.id} a={a} view={view} />
        ))}
      </div>
    </div>
  )
}
