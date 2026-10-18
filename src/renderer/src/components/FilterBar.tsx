import type { CSSProperties } from 'react'
import { Fragment } from 'react'
import { useUI } from '../store/ui'
import { fmtCount, queryAssets, statsOf } from '../data/query'
import { tagMenuItems } from '../data/filter-menu'
import { Dropdown, type MenuItem } from './Dropdown'
import { Icon } from './Icons'

/* 星云粒子落点:对齐原设计的 --x / --y 两个变量(见 content.css 的 nebula-float 关键帧)。
   纵向压到 ±0.4——筛选条只有 42px 高,照抄 35px 的幅度会飞出条外。 */
const NEBULA_PARTICLES = [
  { x: '0.2', y: '-0.25' },
  { x: '0.45', y: '0.15' },
  { x: '0.7', y: '-0.4' },
  { x: '0.9', y: '0.3' },
  { x: '1', y: '-0.1' },
  { x: '0.35', y: '0.4' }
]

const VIEW_ICONS: Record<string, string> = {
  waterfall: 'waterfall',
  grid: 'grid',
  list: 'list'
}

const FORMAT_ITEMS: MenuItem[] = [
  { id: 'all', label: '全部格式', groupEnd: true },
  { id: 'photo', label: 'JPG / PNG / WEBP', heading: '图片' },
  { id: 'psd-ai', label: 'PSD / AI' },
  { id: 'svg-gif', label: 'SVG / GIF' },
  { id: 'video', label: 'MP4 / MOV', heading: '视频' },
  { id: 'glb', label: 'GLB / glTF', heading: '三维' },
  { id: 'fbx', label: 'FBX' },
  { id: 'obj', label: 'OBJ' },
  { id: 'css', label: 'CSS', heading: '代码' }
]

const SHAPE_ITEMS: MenuItem[] = [
  { id: 'all', label: '全部形状', groupEnd: true },
  { id: 'landscape', label: '横图', sub: '16:9 · 3:2' },
  { id: 'portrait', label: '竖图', sub: '9:16 · 3:4' },
  { id: 'square', label: '方形', sub: '1:1' },
  { id: 'pano', label: '全景 / 超宽' }
]

const SIZE_ITEMS: MenuItem[] = [
  { id: 'all', label: '全部尺寸', groupEnd: true },
  { id: 'small', label: '小', sub: '≤1080P' },
  { id: 'medium', label: '中', sub: '1080P ~ 4K' },
  { id: 'large', label: '大', sub: '≥4K' }
]

const RATE_ITEMS: MenuItem[] = [
  { id: 'all', label: '全部评分', groupEnd: true },
  { id: '5', label: '★★★★★' },
  { id: '4up', label: '★★★★ 及以上' },
  { id: '3up', label: '★★★ 及以上' },
  { id: 'none', label: '未评分' }
]

export function FilterBar(): React.JSX.Element {
  const view = useUI((s) => s.view)
  const setView = useUI((s) => s.setView)
  const colw = useUI((s) => s.colw)
  const setColw = useUI((s) => s.setColw)
  const inspHidden = useUI((s) => s.inspHidden)
  const toggleInspector = useUI((s) => s.toggleInspector)
  const cbarOpen = useUI((s) => s.cbarOpen)
  const toggleCbar = useUI((s) => s.toggleCbar)
  const filters = useUI((s) => s.filters)
  const setFilter = useUI((s) => s.setFilter)
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const search = useUI((s) => s.search)
  const setSearch = useUI((s) => s.setSearch)
  const assets = useUI((s) => s.assets)
  const selectedSet = useUI((s) => s.selectedSet)
  const nav = useUI((s) => s.nav)
  const stripColor = useUI((s) => s.stripColor)
  const scanProgress = useUI((s) => s.scanProgress)

  const stats = statsOf(queryAssets(assets, { nav, search, filters, stripColor }))
  const selectedStats = statsOf(assets.filter((asset) => selectedSet.has(asset.id)))

  const paintZoom = (el: HTMLInputElement): void => {
    const p = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100
    el.style.background = `linear-gradient(90deg,var(--acc) ${p}%,rgba(255,255,255,.55) ${p}%)`
  }

  const dropdowns: { key: keyof typeof filters; label: string; items: MenuItem[]; dotColor?: string }[] = [
    { key: 'format', label: '格式', items: FORMAT_ITEMS },
    { key: 'shape', label: '形状', items: SHAPE_ITEMS },
    { key: 'size', label: '尺寸', items: SIZE_ITEMS },
    { key: 'rating', label: '评分', items: RATE_ITEMS },
    { key: 'tag', label: '标签', items: tagMenuItems(assets) }
  ]

  return (
    <div className="filterbar glass-filterbar">
      {/* 搜索框(原在已删除的工具栏里):外观照搬用户给的「星云输入框」——深色底 + 细边框 +
          聚焦紫色辉光 + 粒子,变量与关键帧见 content.css 的 .searchbox。
          按容器改了三处:去掉原设计的 width/margin 居中(位置由筛选条决定)、15px 内边距收成
          34px 高(42px 的条里放不下 47px 的框)、放大镜与 Ctrl F 键帽按设计删掉。
          用户验收后又收三点:描边收细、辉光收一层、标签上浮取消;最后连占位文案也去掉,
          框里不放任何可见文字,用途交给 Ctrl F 快捷键与 aria-label。
          受控输入框:空结果态的「清空搜索」、Esc、切换库标签都会改写关键词,
          输入框必须跟着走,不能停在已经失效的旧文本上。 */}
      <label className="searchbox">
        <input
          className="input"
          type="text"
          value={search}
          aria-label="搜索名称、标签、备注、扩展名"
          onChange={(e) => setSearch(e.target.value)}
        />
        {NEBULA_PARTICLES.map((p) => (
          <span
            key={`${p.x}-${p.y}`}
            className="nebula-particle"
            style={{ '--x': p.x, '--y': p.y } as CSSProperties}
          />
        ))}
      </label>
      <button
        className={`cbtn${cbarOpen ? ' on' : ''}`}
        id="colorBtn"
        title="颜色构造:展示当前视图图片主色,点选颜色即筛选"
        aria-haspopup="menu"
        aria-expanded={cbarOpen}
        onClick={toggleCbar}
      >
        <span className="cball" />
      </button>
      {dropdowns.map((d) => (
        <Fragment key={d.key}>
          <button
            className={`btn${filters[d.key] !== 'all' ? ' on' : ''}${openMenu === `m-f-${d.key}` ? ' open' : ''}`}
            data-menu={`m-f-${d.key}`}
            title={`按${d.label}筛选`}
            aria-haspopup="menu"
            aria-expanded={openMenu === `m-f-${d.key}`}
            onClick={() => setOpenMenu(openMenu === `m-f-${d.key}` ? null : `m-f-${d.key}`)}
          >
            {d.key === 'tag' && filters.tag !== 'all' ? (
              <span
                className="dot"
                style={{ background: assets.flatMap((a) => a.tags).find((t) => t.name === filters.tag)?.color ?? '#64748B' }}
              />
            ) : null}
            {d.label}
            <Icon name="chev-d" className="chev" />
          </button>
          <Dropdown
            id={`m-f-${d.key}`}
            items={d.items}
            value={filters[d.key]}
            onPick={(v) => setFilter(d.key, v)}
          />
        </Fragment>
      ))}
      <span className="vr vr-lead" />
      <span className="fresult">
        {scanProgress ? `${scanProgress} · ` : ''}
        {selectedStats.count > 0 ? (
          <>已选中 <b>{fmtCount(selectedStats.count)}</b> 项 · {selectedStats.size}</>
        ) : (
          <>筛选结果 <b>{fmtCount(stats.count)}</b> 项 · {stats.size}</>
        )}
      </span>
      <button
        className={`btn${openMenu === 'm-view' ? ' open' : ''}`}
        data-menu="m-view"
        title="视图模式"
        aria-haspopup="menu"
        aria-expanded={openMenu === 'm-view'}
        onClick={() => setOpenMenu(openMenu === 'm-view' ? null : 'm-view')}
      >
        <Icon name={VIEW_ICONS[view]} />
        <Icon name="chev-d" className="chev" />
      </button>
      <Dropdown
        id="m-view"
        items={[
          { id: 'waterfall', label: '瀑布流', icon: 'waterfall' },
          { id: 'grid', label: '网格', icon: 'grid' },
          { id: 'list', label: '列表', icon: 'list' }
        ]}
        value={view}
        onPick={(v) => setView(v as typeof view)}
      />
      <span className="vr" />
      <div className="zoomer" title="缩略图大小">
        <Icon name="image" />
        <input
          type="range"
          min={170}
          max={320}
          value={colw}
          aria-label="缩略图大小"
          ref={(el) => { if (el) paintZoom(el) }}
          onChange={(e) => {
            setColw(Number(e.target.value))
            paintZoom(e.target)
          }}
        />
      </div>
      <button
        className={`tb-btn${inspHidden ? ' on' : ''}`}
        id="inspToggle"
        title="隐藏 / 显示右侧信息面板"
        onClick={toggleInspector}
      >
        <Icon name="panel-r" />
      </button>
    </div>
  )
}
