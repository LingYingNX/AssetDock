import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { useUI } from '../store/ui'
import { queryAssets } from '../data/query'
import { DEFAULT_FILTERS } from '../data/query'
import { emptyStateFor } from '../data/empty-state'
import { FALLBACK_THUMB_AR, thumbRatio } from '../data/thumb-ratio'
import { marqueeHits, marqueeRect, type MarqueeCandidate } from '../data/marquee'
import type { Asset } from '../data/types'
import { Card } from './Card'
import { EmptyState } from './EmptyState'

const LHEAD_COLS = ['', '文件名', '类型', '分辨率', '大小', '时长', '导入时间', '']
const VIRTUAL_THRESHOLD = 500
const GAP = 14
const PAD_X = 22
/* 卡片信息区高度:缩略图占卡片 80%、信息区占 20%(默认 232px 列宽下即 44px)。
   与 grid.css 的 figcaption padding (7+7) + name 行高 15 + meta 行高 13 + 行距 2
   对齐。偏小会让瀑布流的虚拟化定位把上下两张卡叠在一起;
   改 figcaption 内边距或 .name/.meta-row 的 line-height 时必须同步改这里。 */
const CAPTION_H = 44
const LIST_ROW_H = 68

/** 列内定位高度:必须与 Card 写进 --ar 的比例同源,否则卡片会错位或留下空档 */
function estHeight(a: Asset, colw: number): number {
  const ar = thumbRatio(a.width, a.height) ?? FALLBACK_THUMB_AR
  return Math.round(colw / ar) + CAPTION_H
}

/** 列分配:贪心放入当前最矮列(保持列内顺序) */
function assignColumns(items: Asset[], colw: number, cols: number): { col: { a: Asset; h: number }[]; h: number }[] {
  const columns = Array.from({ length: cols }, () => ({ col: [] as { a: Asset; h: number }[], h: 0 }))
  for (const a of items) {
    const h = estHeight(a, colw)
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

  // colw 不进 resetKey:拖列宽滑块只该重排列,不该把滚动位置打回顶部
  const resetKey = `${nav}|${search}|${JSON.stringify(filters)}|${stripColor}|${view}|${list.length}`
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
        <div className="gridwrap" ref={wrapRef}>
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
      <div className="gridwrap" ref={wrapRef}>
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
        <CardRows items={list} colw={colw} wrapW={wrapW} virtual={virtual} scrollEl={wrapRef} />
        {marqueeOverlay}
      </div>
    )
  }
  return (
    <div className="gridwrap" ref={wrapRef} {...wrapProps}>
      {trashHeader}
      <Waterfall items={list} colw={colw} wrapW={wrapW} virtual={virtual} scrollEl={wrapRef} />
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
          <Card key={a.id} a={a} view="list" selectionOrder={items.map((item) => item.id)} />
        ))}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5 }}>{head}</div>
      <div style={{ position: 'relative', height: rowV.getTotalSize() }}>
        {rowV.getVirtualItems().map((vi) => (
          <div
            key={items[vi.index].id}
            data-index={vi.index}
            ref={rowV.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
          >
            <Card a={items[vi.index]} view="list" selectionOrder={items.map((item) => item.id)} />
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
  scrollEl
}: {
  items: Asset[]
  colw: number
  wrapW: number
  virtual: boolean
  scrollEl: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  if (!virtual) {
    return (
      <div className="grid v-grid">
        {items.map((a) => (
          <Card key={a.id} a={a} view="grid" selectionOrder={items.map((item) => item.id)} />
        ))}
      </div>
    )
  }
  const avail = Math.max(wrapW - PAD_X * 2, colw)
  const perRow = Math.max(1, Math.floor((avail + 12) / (colw + 12)))
  const rowH = Math.round((colw * 3) / 4) + CAPTION_H
  const rows: Asset[][] = []
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow))
  return <GridVirtualRows rows={rows} rowH={rowH} colw={colw} perRow={perRow} scrollEl={scrollEl} />
}

function GridVirtualRows({
  rows,
  rowH,
  colw,
  perRow,
  scrollEl
}: {
  rows: Asset[][]
  rowH: number
  colw: number
  perRow: number
  scrollEl: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl.current,
    estimateSize: () => rowH,
    overscan: 6
  })
  return (
    <div style={{ position: 'relative', padding: `16px ${PAD_X}px 32px` }}>
      <div style={{ position: 'relative', height: v.getTotalSize() }}>
        {v.getVirtualItems().map((vi) => (
          <div
            key={vi.index}
            data-index={vi.index}
            ref={v.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
          >
            <div style={{ display: 'flex', gap: 12 }}>
              {rows[vi.index].map((a) => (
                <div key={a.id} style={{ width: colw, flex: `0 0 ${colw}px` }}>
                  <Card a={a} view="grid" selectionOrder={rows.flat().map((item) => item.id)} />
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
  scrollEl
}: {
  items: Asset[]
  colw: number
  wrapW: number
  virtual: boolean
  scrollEl: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  if (!virtual) {
    return (
      <div className="grid">
        {items.map((a) => (
          <Card key={a.id} a={a} view="waterfall" selectionOrder={items.map((item) => item.id)} />
        ))}
      </div>
    )
  }
  const avail = Math.max(wrapW - PAD_X * 2, colw)
  const cols = Math.max(1, Math.floor((avail + GAP) / (colw + GAP)))
  const columns = assignColumns(items, colw, cols)
  const totalH = Math.max(...columns.map((c) => c.h), 0)
  return (
    <div style={{ position: 'relative', height: totalH + 40, margin: `16px ${PAD_X}px 32px` }}>
      {columns.map((c, i) => (
        <WaterColumn
          key={i}
          items={c.col}
          left={i * (colw + GAP)}
          width={colw}
          height={c.h}
          scrollEl={scrollEl}
        />
      ))}
    </div>
  )
}

function WaterColumn({
  items,
  left,
  width,
  height,
  scrollEl
}: {
  items: { a: Asset; h: number }[]
  left: number
  width: number
  height: number
  scrollEl: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl.current,
    estimateSize: (i) => items[i].h,
    overscan: 8
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
            <Card a={items[vi.index].a} view="waterfall" selectionOrder={items.map((item) => item.a.id)} />
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
