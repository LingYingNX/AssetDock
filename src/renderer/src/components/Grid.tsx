import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { useUI } from '../store/ui'
import { queryAssets } from '../data/query'
import { DEFAULT_FILTERS } from '../data/query'
import { emptyStateFor } from '../data/empty-state'
import { FALLBACK_THUMB_AR, thumbRatio } from '../data/thumb-ratio'
import { fitColumns } from '../data/colw'
import { marqueeHits, marqueeRect, type MarqueeCandidate } from '../data/marquee'
import type { Asset } from '../data/types'
import { Card } from './Card'
import { EmptyState } from './EmptyState'

const LHEAD_COLS = ['', '文件名', '类型', '分辨率', '大小', '时长', '导入时间', '']
/* 文件夹切换是高频操作。原阈值 500 会让真实库中 285~319 项的目录切换重建整组卡片,
   实测已到 210~268ms;40 项起走虚拟化,把一次切换限制在当前视口附近。 */
const VIRTUAL_THRESHOLD = 40
/* 卡片横纵间距统一;虚拟化时由 gap 补上,非虚拟化由 CSS 承担。 */
const GAP = 10
const PAD_X = 11
/* 信息栏在缩略图下方,固定两档高度;必须与 grid.css 的 figcaption 高度一致。 */
const CAPTION_H = 24
const LIST_ROW_H = 68

/* 关掉名字时说明栏整条不渲染,虚拟化的估算高度必须跟着归零,否则每张卡下方留 24px 空洞 */
function captionHeight(showName: boolean): number {
  return showName ? CAPTION_H : 0
}

/** 列内定位高度:必须与 Card 写进 --ar 的比例同源,否则卡片会错位或留下空档 */
function estHeight(a: Asset, colw: number, showName: boolean): number {
  const ar = thumbRatio(a.width, a.height) ?? FALLBACK_THUMB_AR
  /* 卡片有左右各 1px 边框,缩略图实际宽度是 colw-2。 */
  return Math.round((colw - 2) / ar + 2 + captionHeight(showName))
}

/** 列分配:贪心放入当前最矮列(保持列内顺序) */
function assignColumns(items: Asset[], colw: number, cols: number, showName: boolean): { col: { a: Asset; h: number }[]; h: number }[] {
  const columns = Array.from({ length: cols }, () => ({ col: [] as { a: Asset; h: number }[], h: 0 }))
  for (const a of items) {
    const h = estHeight(a, colw, showName)
    let target = 0
    for (let i = 1; i < cols; i++) if (columns[i].h < columns[target].h) target = i
    columns[target].col.push({ a, h })
    columns[target].h += h + GAP
  }
  return columns
}

export function Grid(): React.JSX.Element {
  const view = useUI((s) => s.view)
  const assets = useUI((s) => s.assets)
  const mode = useUI((s) => s.mode)
  const nav = useUI((s) => s.nav)
  const search = useUI((s) => s.search)
  const filters = useUI((s) => s.filters)
  const stripColor = useUI((s) => s.stripColor)
  const colw = useUI((s) => s.colw)
  const showName = useUI((s) => s.display.name)
  const clearSelection = useUI((s) => s.clearSelection)
  const setSelectedIds = useUI((s) => s.setSelectedIds)
  const setSearch = useUI((s) => s.setSearch)
  const setNav = useUI((s) => s.setNav)
  const createLibraryFlow = useUI((s) => s.createLibraryFlow)
  const emptyTrash = useUI((s) => s.emptyTrash)
  const reloadActiveLibrary = useUI((s) => s.reloadActiveLibrary)
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [wrapW, setWrapW] = useState(1200)
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const list = useMemo(
    () => queryAssets(assets, { nav, search, filters, stripColor }),
    [assets, nav, search, filters, stripColor]
  )

  // colw 与结果数量都不进 resetKey:拖列宽、后台重扫或移动文件夹都可能改变数量,
  // 但用户没有换视图;此时归顶会让整个网格闪一下。只有导航/搜索/筛选/视图变化才回顶部。
  const resetKey = `${nav}|${search}|${JSON.stringify(filters)}|${stripColor}|${view}`
  useEffect(() => {
    wrapRef.current?.scrollTo({ top: 0 })
  }, [resetKey])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth))
    ro.observe(el)
    setWrapW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const canEmpty = tabs.find((t) => t.id === activeTabId)?.libraryId != null

  /* 刷选中途的收尾入口。组件卸载时必须也能摘掉全局监听,否则监听会活过这个 Grid。 */
  const dragTeardownRef = useRef<(() => void) | null>(null)
  useEffect(() => () => dragTeardownRef.current?.(), [])

  const captureCards = (): MarqueeCandidate[] => {
    const cards = wrapRef.current?.querySelectorAll<HTMLElement>('.card[data-asset-id]')
    const out: MarqueeCandidate[] = []
    if (cards) {
      for (const card of cards) {
        const id = card.dataset.assetId
        if (id == null) continue
        const r = card.getBoundingClientRect()
        out.push({ id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
      }
    }
    return out
  }

  const startMarquee = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.card, button, input, textarea, select, a, [contenteditable]')) return

    const startX = event.clientX
    const startY = event.clientY
    // 清选与建框都推迟到真的拖过阈值:仅一次空白点击不该先闪一个 2px 方块、
    // 再把已有选区清掉——那让单击空白变成破坏性操作。
    const THRESHOLD = 4
    let armed = false
    /* 拖动期间卡片不会重排,所以矩形只采一次;快照在结束时释放 */
    let snapshot: MarqueeCandidate[] | null = null

    /**
     * 唯一的结束路径:摘掉全部全局监听、释放快照、清选框。
     * 鼠标在窗口外松手、拖动被系统取消、组件卸载都从这一处收尾。
     */
    const end = (clearBox: boolean): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('pointercancel', onCancel)
      snapshot = null
      dragTeardownRef.current = null
      if (clearBox) setMarquee(null)
    }
    const onUp = (): void => end(true)
    const onCancel = (): void => end(true)

    const move = (moveEvent: MouseEvent): void => {
      // 在窗口外松手时浏览器不会补发 mouseup:按键已经抬起就当作结束,
      // 否则回到窗口内继续移动鼠标会拖着上一次的选框。
      if (moveEvent.buttons === 0) {
        end(true)
        return
      }
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (!armed) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return
        armed = true
        event.preventDefault()
        clearSelection()
        snapshot = captureCards()
      }
      const box = marqueeRect(startX, startY, moveEvent.clientX, moveEvent.clientY)
      setMarquee({
        left: box.left,
        top: box.top,
        width: box.right - box.left,
        height: box.bottom - box.top
      })
      setSelectedIds(marqueeHits(box, snapshot ?? []))
    }

    dragTeardownRef.current = () => end(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onCancel)
    window.addEventListener('pointercancel', onCancel)
  }
  const trashHeader = nav === 'trash' ? <TrashHeader canEmpty={canEmpty} onEmpty={emptyTrash} /> : null
  const wrapProps = { onMouseDown: startMarquee }
  const marqueeOverlay = marquee ? <div className="marquee" style={marquee} /> : null

  if (list.length === 0) {
    /* 加载失败是独立状态:不能借用「这个视图下没有素材」,那句话等于说库是空的 */
    if (mode === 'error') {
      return (
        <div className="gridwrap is-empty" ref={wrapRef}>
          <EmptyState kind="library" title="素材库加载失败" actionLabel="重新加载" onAction={reloadActiveLibrary} />
        </div>
      )
    }
    const empty = emptyStateFor({ mode, nav, search, filters, stripColor })
    const clearFilters = (): void => {
      clearSelection()
      setSearch('')
      useUI.setState({ filters: DEFAULT_FILTERS, stripColor: null })
    }
    const onEmptyAction =
      empty.action === 'newLibrary'
        ? createLibraryFlow
        : empty.action === 'clearFilters'
          ? clearFilters
          : empty.action === 'backAll'
            ? () => setNav('all')
            : undefined
    return (
      <div className="gridwrap is-empty" ref={wrapRef}>
        {trashHeader}
        <EmptyState
          kind={empty.kind}
          title={empty.title}
          actionLabel={
            empty.action === 'newLibrary'
              ? '新建素材库'
              : empty.action === 'clearFilters'
                ? '清空筛选'
                : empty.action === 'backAll'
                  ? '返回全部素材'
                  : undefined
          }
          onAction={onEmptyAction}
        />
      </div>
    )
  }

  const virtual = list.length > VIRTUAL_THRESHOLD

  if (view === 'list') {
    return (
      <div className="gridwrap" ref={wrapRef} {...wrapProps}>
        {trashHeader}
        <ListRows items={list} virtual={virtual} scrollEl={wrapRef} />
        {marqueeOverlay}
      </div>
    )
  }
  if (view === 'grid') {
    return (
      <div className="gridwrap" ref={wrapRef} {...wrapProps}>
        {trashHeader}
        <CardRows items={list} colw={colw} wrapW={wrapW} virtual={virtual} showName={showName} scrollEl={wrapRef} />
        {marqueeOverlay}
      </div>
    )
  }
  return (
    <div className="gridwrap" ref={wrapRef} {...wrapProps}>
      {trashHeader}
      <Waterfall items={list} colw={colw} wrapW={wrapW} virtual={virtual} showName={showName} scrollEl={wrapRef} />
      {marqueeOverlay}
    </div>
  )
}

/* ---------------- 列表 ---------------- */

function ListRows({
  items,
  virtual,
  scrollEl
}: {
  items: Asset[]
  virtual: boolean
  scrollEl: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const order = useMemo(() => items.map((item) => item.id), [items])
  const rowV = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => scrollEl.current,
    estimateSize: () => LIST_ROW_H,
    overscan: 10
  })
  const head = (
    <div className="lhead">
      {LHEAD_COLS.map((h, i) => (
        <span key={i}>{h}</span>
      ))}
    </div>
  )
  if (!virtual) {
    return (
      <div className="grid v-list">
        {head}
        {items.map((a) => (
          <Card key={a.id} a={a} view="list" selectionOrder={order} />
        ))}
      </div>
    )
  }
  return (
    <div className="v-list" style={{ position: 'relative', padding: '0 0 24px' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5 }}>{head}</div>
      <div style={{ position: 'relative', height: rowV.getTotalSize() }}>
        {rowV.getVirtualItems().map((vi) => (
          <div
            key={items[vi.index].id}
            data-index={vi.index}
            ref={rowV.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
          >
            <Card a={items[vi.index]} view="list" selectionOrder={order} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 网格 ---------------- */

function CardRows({
  items,
  colw,
  wrapW,
  virtual,
  showName,
  scrollEl
}: {
  items: Asset[]
  colw: number
  wrapW: number
  virtual: boolean
  showName: boolean
  scrollEl: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const order = useMemo(() => items.map((item) => item.id), [items])
  if (!virtual) {
    return (
      <div className="grid v-grid">
        {items.map((a) => (
          <Card key={a.id} a={a} view="grid" selectionOrder={order} />
        ))}
      </div>
    )
  }
  const avail = Math.max(wrapW - PAD_X * 2, colw)
  const { cols: perRow, width: cellW } = fitColumns(avail, colw, GAP)
  const rows: Asset[][] = []
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow))
  const rowHs = rows.map(() => Math.round((cellW - 2) * 3 / 4 + 2 + captionHeight(showName)))
  return <GridVirtualRows rows={rows} rowHs={rowHs} cellW={cellW} perRow={perRow} scrollEl={scrollEl} />
}

function GridVirtualRows({
  rows,
  rowHs,
  cellW,
  perRow,
  scrollEl
}: {
  rows: Asset[][]
  rowHs: number[]
  cellW: number
  perRow: number
  scrollEl: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const order = useMemo(() => rows.flat().map((item) => item.id), [rows])
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl.current,
    estimateSize: (i) => rowHs[i],
    gap: GAP,
    overscan: 6
  })
  return (
    <div className="v-grid" style={{ position: 'relative', padding: `8px ${PAD_X}px 32px` }}>
      <div style={{ position: 'relative', height: v.getTotalSize() }}>
        {v.getVirtualItems().map((vi) => (
          <div
            key={vi.index}
            data-index={vi.index}
            ref={v.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
          >
            <div style={{ display: 'flex', gap: GAP }}>
              {rows[vi.index].map((a) => (
                <div key={a.id} style={{ width: cellW, flex: `0 0 ${cellW}px` }}>
                  <Card a={a} view="grid" selectionOrder={order} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 瀑布流 ---------------- */

function Waterfall({
  items,
  colw,
  wrapW,
  virtual,
  showName,
  scrollEl
}: {
  items: Asset[]
  colw: number
  wrapW: number
  virtual: boolean
  showName: boolean
  scrollEl: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const order = useMemo(() => items.map((item) => item.id), [items])
  /* 非虚拟也走同一套按高度分列:CSS 多列由浏览器分列,长卡会被挤成一列高、一列空,
     右侧留出整条空隙;贪心分列让各列底边齐平 */
  const avail = Math.max(wrapW - PAD_X * 2, colw)
  const { cols, width: cellW } = fitColumns(avail, colw, GAP)
  const columns = assignColumns(items, cellW, cols, showName)
  const totalH = Math.max(...columns.map((c) => c.h), 0)
  return (
    <div style={{ position: 'relative', height: totalH + 40, margin: `8px ${PAD_X}px 32px` }}>
      {columns.map((c, i) =>
        virtual ? (
          <WaterColumn
            key={i}
            items={c.col}
            order={order}
            left={i * (cellW + GAP)}
            width={cellW}
            height={c.h}
            scrollEl={scrollEl}
          />
        ) : (
          <div key={i} style={{ position: 'absolute', left: i * (cellW + GAP), top: 0, width: cellW }}>
            {c.col.map(({ a }) => (
              <Card key={a.id} a={a} view="waterfall" selectionOrder={order} />
            ))}
          </div>
        )
      )}
    </div>
  )
}

function WaterColumn({
  items,
  order,
  left,
  width,
  height,
  scrollEl
}: {
  items: { a: Asset; h: number }[]
  order: string[]
  left: number
  width: number
  height: number
  scrollEl: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl.current,
    estimateSize: (i) => items[i].h,
    gap: GAP,
    /* 文件夹切换会同时替换整列虚拟项;保留少量预渲染即可兼顾滚动与切目录延迟。 */
    overscan: 4
  })
  void height
  return (
    <div style={{ position: 'absolute', left, top: 0, width }}>
      <div style={{ position: 'relative', height: v.getTotalSize() }}>
        {v.getVirtualItems().map((vi) => (
          <div
            key={items[vi.index].a.id}
            data-index={vi.index}
            style={{ position: 'absolute', top: 0, left: 0, width, transform: `translateY(${vi.start}px)` }}
          >
            <Card a={items[vi.index].a} view="waterfall" selectionOrder={order} />
          </div>
        ))}
      </div>
    </div>
  )
}

function TrashHeader({ canEmpty, onEmpty }: { canEmpty: boolean; onEmpty: () => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 22px 0' }}>
      <span style={{ fontSize: 11.5, color: 'var(--t3)' }}>回收站中的素材 · 恢复:右键 →「从回收站恢复」</span>
      {canEmpty && (
        <button className="btn-clear" style={{ marginLeft: 'auto' }} onClick={onEmpty}>
          清空回收站(仅移除记录,不动文件)
        </button>
      )}
    </div>
  )
}

export type { Virtualizer }
