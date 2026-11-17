import type { CSSProperties } from 'react'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useUI } from '../store/ui'
import { fmtCount, queryAssets, statsOf } from '../data/query'
import { tagMenuItemsForView } from '../data/filter-menu'
import { Dropdown, type MenuItem } from './Dropdown'
import { Icon } from './Icons'
import { TagFilterMenu } from './TagFilterMenu'
import { COLW_STEPS, colwToSlider, sliderToColw } from '../data/colw'
import { FORMAT_GROUPS, type AssetFormat } from '../../../shared/formats'

/* 星云粒子落点:对齐原设计的 --x / --y 两个变量(见 content.css 的 nebula-float 关键帧)。
   纵向压到 ±0.4——筛选条只有 36px 高,照抄 35px 的幅度会飞出条外。 */
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

const HOVER_OPEN_DELAY_MS = 50

const FORMAT_LABELS: Partial<Record<AssetFormat, string>> = {
  GLB: 'GLB / glTF',
  HEIC: 'HEIC / HEIF',
  MPEG: 'MPEG / MPG',
  VRML: 'VRML / WRL'
}

const FORMAT_ITEMS: MenuItem[] = [
  { id: 'all', label: '全部格式', groupEnd: true },
  ...FORMAT_GROUPS.flatMap((group, groupIndex) => group.formats.map((format, formatIndex) => ({
    id: format,
    label: FORMAT_LABELS[format] ?? format,
    heading: formatIndex === 0 ? group.label : undefined,
    groupEnd: formatIndex === group.formats.length - 1 && groupIndex < FORMAT_GROUPS.length - 1
  })))
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
  { id: '4up', label: '★★★★' },
  { id: '3up', label: '★★★' },
  { id: '2up', label: '★★' },
  { id: '1up', label: '★' }
]

export function FilterBar(): React.JSX.Element {
  const view = useUI((s) => s.view)
  const setView = useUI((s) => s.setView)
  const colw = useUI((s) => s.colw)
  const setColw = useUI((s) => s.setColw)
  const cbarOpen = useUI((s) => s.cbarOpen)
  const toggleCbar = useUI((s) => s.toggleCbar)
  const filters = useUI((s) => s.filters)
  const setFilter = useUI((s) => s.setFilter)
  const setTags = useUI((s) => s.setTags)
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const search = useUI((s) => s.search)
  const setSearch = useUI((s) => s.setSearch)
  const assets = useUI((s) => s.assets)
  const activeLibraryId = useUI((s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.libraryId ?? null)
  const selectedSet = useUI((s) => s.selectedSet)
  const nav = useUI((s) => s.nav)
  const stripColor = useUI((s) => s.stripColor)
  const scanProgress = useUI((s) => s.scanProgress)
  const hoverTimer = useRef<number | null>(null)
  const hoverCloseTimer = useRef<number | null>(null)

  const cancelHoverOpen = (): void => {
    if (hoverTimer.current === null) return
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
  }
  const cancelHoverClose = (): void => {
    if (hoverCloseTimer.current === null) return
    window.clearTimeout(hoverCloseTimer.current)
    hoverCloseTimer.current = null
  }
  const keepHoverOpen = (): void => {
    cancelHoverOpen()
    cancelHoverClose()
  }
  /* 悬停展开后指针移开要收回;留 180ms 给「从触发按钮移进下拉面板」这段缝隙 */
  const scheduleHoverClose = (): void => {
    cancelHoverOpen()
    cancelHoverClose()
    hoverCloseTimer.current = window.setTimeout(() => {
      hoverCloseTimer.current = null
      setOpenMenu(null)
    }, 180)
  }

  const openAfterHover = (id: string): void => {
    keepHoverOpen()
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      setOpenMenu(id)
    }, HOVER_OPEN_DELAY_MS)
  }

  useEffect(() => () => {
    cancelHoverOpen()
    cancelHoverClose()
  }, [])

  const stats = useMemo(
    () => statsOf(queryAssets(assets, { nav, search, filters, stripColor })),
    [assets, nav, search, filters, stripColor]
  )
  const selectedStats = useMemo(
    () => statsOf(assets.filter((asset) => selectedSet.has(asset.id))),
    [assets, selectedSet]
  )
  const tagItems = useMemo(
    () => tagMenuItemsForView(assets, { nav, search, filters, stripColor }),
    [assets, nav, search, filters, stripColor]
  )
  const result = selectedStats.count > 0
    ? { label: '已选中', count: selectedStats.count, size: selectedStats.size }
    : { label: '筛选结果', count: stats.count, size: stats.size }

  const zoomPct = (colwToSlider(colw) / COLW_STEPS) * 100

  const dropdowns: { key: Exclude<keyof typeof filters, 'tags'>; label: string; items: MenuItem[] }[] = [
    { key: 'format', label: '格式', items: FORMAT_ITEMS },
    { key: 'shape', label: '形状', items: SHAPE_ITEMS },
    { key: 'size', label: '尺寸', items: SIZE_ITEMS },
    { key: 'rating', label: '评分', items: RATE_ITEMS }
  ]

  return (
    <div className="filterbar glass-filterbar">
      {/* 搜索框(原在已删除的工具栏里):外观照搬用户给的「星云输入框」——深色底 + 细边框 +
          聚焦紫色辉光 + 粒子,变量与关键帧见 content.css 的 .searchbox。
          按容器改了三处:去掉原设计的 width/margin 居中(位置由筛选条决定)、15px 内边距收成
          28px 高(36px 的条里上下各留 4px)、放大镜与 Ctrl F 键帽按设计删掉。
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
          name="asset-search"
          autoComplete="off"
          spellCheck={false}
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
        aria-label="颜色构造"
        aria-haspopup="menu"
        aria-expanded={cbarOpen}
        onClick={toggleCbar}
      >
        <span className="cball" />
      </button>
      <div className="filter-group" role="group" aria-label="筛选条件">
        {dropdowns.map((d) => (
          <Fragment key={d.key}>
            <button
              className={`btn${filters[d.key] !== 'all' ? ' on' : ''}${openMenu === `m-f-${d.key}` ? ' open' : ''}`}
              data-menu={`m-f-${d.key}`}
              title={`按${d.label}筛选`}
              aria-haspopup="menu"
              aria-expanded={openMenu === `m-f-${d.key}`}
              onPointerEnter={() => openAfterHover(`m-f-${d.key}`)}
              onPointerLeave={scheduleHoverClose}
              onClick={() => {
                cancelHoverOpen()
                setOpenMenu(`m-f-${d.key}`)
              }}
            >
              {d.label}
            </button>
            <Dropdown
              id={`m-f-${d.key}`}
              items={d.items}
              value={filters[d.key]}
              onPick={(v) => setFilter(d.key, v)}
              onPointerEnter={keepHoverOpen}
            />
          </Fragment>
        ))}
        <button
          className={`btn tag-filter-trigger${filters.tags.length > 0 ? ' on' : ''}${openMenu === 'm-f-tag' ? ' open' : ''}`}
          data-menu="m-f-tag"
          title="按标签筛选"
          aria-haspopup="dialog"
          aria-expanded={openMenu === 'm-f-tag'}
          onPointerEnter={() => openAfterHover('m-f-tag')}
          onPointerLeave={scheduleHoverClose}
          onClick={() => {
            cancelHoverOpen()
            setOpenMenu('m-f-tag')
          }}
        >
          <span
            className={`dot${filters.tags.length === 0 ? ' is-empty' : ''}`}
            aria-hidden="true"
            style={{ background: tagItems.find((item) => item.id === filters.tags[0])?.dotColor ?? 'var(--t3)' }}
          />
          标签
        </button>
        <TagFilterMenu
          id="m-f-tag"
          items={tagItems}
          value={filters.tags}
          libraryId={activeLibraryId}
          onPointerEnter={keepHoverOpen}
          onPick={(tag, additive) => {
            if (tag === 'all') {
              setTags([])
              return
            }
            if (additive) {
              setTags(filters.tags.includes(tag)
                ? filters.tags.filter((item) => item !== tag)
                : [...filters.tags, tag])
              return
            }
            setTags(filters.tags.length === 1 && filters.tags[0] === tag ? [] : [tag])
          }}
        />
      </div>
      <span className="vr" />
      <span className="fresult" aria-live="polite">
        {scanProgress ? `${scanProgress} · ` : ''}
        <span className="fresult-label">{result.label}</span>
        <b className="fresult-count">{fmtCount(result.count)}</b>
        <span className="fresult-unit">项 ·</span>
        <span className="fresult-size">{result.size}</span>
      </span>
      <button
        className={`btn${openMenu === 'm-view' ? ' open' : ''}`}
        data-menu="m-view"
        title="视图模式"
        aria-label={`视图模式：${view === 'waterfall' ? '瀑布流' : view === 'grid' ? '网格' : '列表'}`}
        aria-haspopup="menu"
        aria-expanded={openMenu === 'm-view'}
        onClick={() => setOpenMenu(openMenu === 'm-view' ? null : 'm-view')}
      >
        <Icon name={VIEW_ICONS[view]} />
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
      <div className="zoomer" title={`缩略图大小:${colw}px`}>
        <Icon name="image" />
        <input
          type="range"
          min={0}
          max={COLW_STEPS}
          value={colwToSlider(colw)}
          aria-label="缩略图大小"
          aria-valuetext={`${colw}px`}
          style={{ background: `linear-gradient(90deg,var(--acc) ${zoomPct}%,rgba(255,255,255,.55) ${zoomPct}%)` }}
          onChange={(e) => setColw(sliderToColw(Number(e.target.value)))}
        />
      </div>
    </div>
  )
}
