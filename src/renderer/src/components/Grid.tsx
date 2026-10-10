import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { useUI } from '../store/ui'
import { queryAssets } from '../data/query'
import { FALLBACK_THUMB_AR, thumbRatio } from '../data/thumb-ratio'
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
  const swatches = useUI((s) => s.swatches)
  const stripColor = useUI((s) => s.stripColor)
  const colw = useUI((s) => s.colw)
  const clearSelection = useUI((s) => s.clearSelection)
  const setSelectedIds = useUI((s) => s.setSelectedIds)
  const setSearch = useUI((s) => s.setSearch)
  const createLibraryFlow = useUI((s) => s.createLibraryFlow)
  const emptyTrash = useUI((s) => s.emptyTrash)
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [wrapW, setWrapW] = useState(1200)
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const list = useMemo(
    () => queryAssets(assets, { nav, search, filters, swatches, stripColor }),
    [assets, nav, search, filters, swatches, stripColor]
  )

  // colw 不进 resetKey:拖列宽滑块只该重排列,不该把滚动位置打回顶部
  const resetKey = `${nav}|${search}|${JSON.stringify(filters)}|${swatches.join(',')}|${stripColor}|${view}|${list.length}`
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

    const move = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (!armed) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return
        armed = true
        event.preventDefault()
        clearSelection()
      }
      const left = Math.min(startX, moveEvent.clientX)
      const top = Math.min(startY, moveEvent.clientY)
      const width = Math.abs(dx)
      const height = Math.abs(dy)
      setMarquee({ left, top, width, height })
      const cards = wrapRef.current?.querySelectorAll<HTMLElement>('.card[data-asset-id]')
      if (!cards) return
      const selected = Array.from(cards)
        .filter((card) => {
          const r = card.getBoundingClientRect()
          return r.left < left + width && r.right > left && r.top < top + height && r.bottom > top
        })
        .map((card) => card.dataset.assetId)
        .filter((id): id is string => id != null)
      setSelectedIds(selected)
    }

    const finish = () => {
      window.removeEventListener('mousemove', move)
      setMarquee(null)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', finish, { once: true })
  }
  const trashHeader = nav === 'trash' ? <TrashHeader canEmpty={canEmpty} onEmpty={emptyTrash} /> : null
  const wrapProps = { onMouseDown: startMarquee }
  const marqueeOverlay = marquee ? <div className="marquee" style={marquee} /> : null

  if (list.length === 0) {
    const kind = nav === 'trash' || mode === 'library' ? (nav === 'trash' ? 'trash' : 'library') : 'results'
    const title =
      kind === 'trash'
        ? '回收站是空的'
        : mode === 'empty'
          ? '还没有素材库'
          : kind === 'library'
          ? '这个视图下没有素材'
          : '没有符合当前筛选条件的素材'
    return (
      <div className="gridwrap" ref={wrapRef}>
        {trashHeader}
        <EmptyState
          kind={kind}
          title={title}
          actionLabel={mode === 'empty' ? '新建素材库' : kind === 'results' ? '清空搜索' : undefined}
          onAction={
            mode === 'empty'
              ? createLibraryFlow
              : kind === 'results'
              ? () => {
                  clearSelection()
                  setSearch('')
                }
              : undefined
          }
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
