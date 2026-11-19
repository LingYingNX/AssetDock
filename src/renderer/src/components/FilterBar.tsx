import type { CSSProperties } from 'react'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useUI } from '../store/ui'
import { DEFAULT_FILTERS, fmtCount, queryAssets, statsOf } from '../data/query'
import { formatMenuGroups, tagMenuItemsForView } from '../data/filter-menu'
import { Dropdown, type MenuItem } from './Dropdown'
import { Icon } from './Icons'
import { TagFilterMenu } from './TagFilterMenu'
import { DisplayMenu } from './DisplayMenu'
import { COLW_STEPS, colwToSlider, sliderToColw } from '../data/colw'
import type { AssetFormat } from '../../../shared/formats'

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
  const collapsedFormatGroups = useUI((s) => s.collapsedFormatGroups)
  const toggleFormatGroup = useUI((s) => s.toggleFormatGroup)
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
  /* 格式菜单只列当前视图(当前文件夹/导航项)真实存在的格式,避免几十个空格式。
     过滤条件不参与统计——它是「这个文件夹有什么」,不是「当前筛选结果有什么」,
     否则选中某个格式后其余格式会整批消失。 */
  const folderFormats = useMemo(() => {
    const set = new Set<string>()
    for (const asset of queryAssets(assets, { nav, search: '', filters: DEFAULT_FILTERS, stripColor: null })) {
      set.add(asset.format)
    }
    return set
  }, [assets, nav])
  const formatItems = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [{ id: 'all', label: '全部格式' }]
    for (const group of formatMenuGroups(folderFormats, filters.format, collapsedFormatGroups)) {
      items.push({
        id: `group:${group.type}`,
        label: '',
        heading: group.label,
        groupOpen: group.open,
        onToggleGroup: () => toggleFormatGroup(group.type)
      })
      if (!group.open) continue
      for (const format of group.formats) {
        items.push({ id: format, label: FORMAT_LABELS[format as AssetFormat] ?? format })
      }
    }
    return items
  }, [folderFormats, filters.format, collapsedFormatGroups, toggleFormatGroup])
  const result = selectedStats.count > 0
    ? { label: '已选中', count: selectedStats.count, size: selectedStats.size }
    : { label: '筛选结果', count: stats.count, size: stats.size }

  const zoomPct = (colwToSlider(colw) / COLW_STEPS) * 100

  const dropdowns: { key: Exclude<keyof typeof filters, 'tags'>; label: string; items: MenuItem[] }[] = [
    { key: 'format', label: '格式', items: formatItems },
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
        <svg className="cball" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
          <path d="M273.612499 729.948748L164.413357 839.516529A490.454059 490.454059 0 0 1 20.439245 491.725865h154.623691c0 92.979014 37.765044 177.069726 98.508603 238.222883" fill="#006AFF" />
          <path d="M512.204021 828.457351v154.99233h-0.409599a489.511981 489.511981 0 0 1-347.340105-143.933152l109.117222-109.567781a337.018206 337.018206 0 0 0 238.181923 98.508603h0.409599z" fill="#4ECAF1" />
          <path d="M859.585087 839.516529a489.7987 489.7987 0 0 1-347.381066 143.933152v-154.99233a336.199008 336.199008 0 0 0 237.813285-98.508603l109.567781 109.567781z" fill="#93E556" />
          <path d="M1003.518239 491.725865c0 135.454449-55.21397 258.620923-143.933152 347.749704l-109.567781-109.526821a337.100126 337.100126 0 0 0 98.508603-238.222883H1003.518239z" fill="#FFEE4A" />
          <path d="M1003.518239 491.725865h-154.99233a337.100126 337.100126 0 0 0-98.508603-238.222884l109.567781-109.567781A491.437097 491.437097 0 0 1 1003.518239 491.725865" fill="#FFA532" />
          <path d="M859.544127 143.9352L750.058266 253.543941A337.182046 337.182046 0 0 0 511.794422 154.994378V0.002048c135.905008 0 258.989562 54.76341 347.749705 143.933152" fill="#EB3F3B" />
          <path d="M511.794422 0.002048v154.99233c-92.979014 0-177.069726 37.806004-238.181923 98.508603L164.413357 143.97616A487.955504 487.955504 0 0 1 511.753462 0.002048" fill="#EE509E" />
          <path d="M273.612499 253.502981A336.936286 336.936286 0 0 0 175.021976 491.684905H20.480205C20.480205 355.820856 75.284575 233.104942 164.454317 143.9352l109.117222 109.567781z" fill="#7F4AEB" />
        </svg>
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
      <button
        className={`btn${openMenu === 'm-display' ? ' open' : ''}`}
        data-menu="m-display"
        title="显示选项"
        aria-label="显示选项"
        aria-haspopup="menu"
        aria-expanded={openMenu === 'm-display'}
        onClick={() => setOpenMenu(openMenu === 'm-display' ? null : 'm-display')}
      >
        <Icon name="sliders" />
      </button>
      <DisplayMenu />
      <div className="zoomer" title={`缩略图大小:${colw}px`}>
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
