import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { useUI } from '../store/ui'
import { queryAssets } from '../data/query'
import type { Asset } from '../data/types'
import { Card } from './Card'
import { Icon } from './Icons'
import { EmptyState } from './EmptyState'

const LHEAD_COLS = ['', '文件名', '类型', '分辨率', '大小', '时长', '导入时间', '']
const VIRTUAL_THRESHOLD = 500
const GAP = 14
const PAD_X = 22
const CAPTION_H = 54
const LIST_ROW_H = 68

function estHeight(a: Asset, colw: number): number {
  const ar = a.width && a.height ? a.width / a.height : 4 / 3
  const clamped = Math.min(3, Math.max(0.5, ar))
  return Math.round(colw / clamped) + CAPTION_H
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
  const setSearch = useUI((s) => s.setSearch)
  const createLibraryFlow = useUI((s) => s.createLibraryFlow)
  const addTab = useUI((s) => s.addTab)
  const emptyTrash = useUI((s) => s.emptyTrash)
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)

  const wrapRef = useRef<HTMLDivElement>(null)
  const [wrapW, setWrapW] = useState(1200)

  const list = useMemo(
    () => queryAssets(assets, { nav, search, filters, swatches, stripColor }),
    [assets, nav, search, filters, swatches, stripColor]
  )

  const resetKey = `${nav}|${search}|${JSON.stringify(filters)}|${swatches.join(',')}|${stripColor}|${view}|${colw}|${list.length}`
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
  const trashHeader = nav === 'trash' ? <TrashHeader canEmpty={canEmpty} onEmpty={emptyTrash} /> : null

  if (list.length === 0) {
    const kind = nav === 'trash' ? 'trash' : mode === 'library' ? 'library' : 'results'
    const title =
      kind === 'trash'
        ? '回收站是空的'
        : kind === 'library'
          ? '这个视图下没有素材'
          : '没有符合当前筛选条件的素材'
    return (
      <div className="gridwrap" ref={wrapRef}>
        {trashHeader}
        <EmptyState
          kind={kind}
          title={title}
          actionLabel={kind === 'results' ? '清空搜索' : undefined}
          onAction={
            kind === 'results'
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

  /* 演示模式建库引导卡 */
  const guide =
    mode === 'demo' && nav === 'all' && list.length > 0 ? (
      <div
        style={{
          margin: '14px 22px 0',
          padding: '10px 14px',
          borderRadius: 12,
          border: '1px dashed var(--line2)',
          background: 'var(--bg2)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
          color: 'var(--t2)'
        }}
      >
        <Icon name="spark" />
        <span>这是演示数据。把常用文件夹变成素材库,即可真实浏览与管理。</span>
        <button className="btn-clear" style={{ marginLeft: 'auto', borderColor: 'var(--acc-line)', color: '#0A5AC2' }} onClick={createLibraryFlow}>
          新建素材库
        </button>
      </div>
    ) : null

  if (view === 'list') {
    return (
      <div className="gridwrap" ref={wrapRef}>
        {trashHeader}
        {guide}
        <ListRows items={list} virtual={virtual} scrollEl={wrapRef} />
      </div>
    )
  }
  if (view === 'grid') {
    return (
      <div className="gridwrap" ref={wrapRef}>
        {trashHeader}
        {guide}
        <CardRows items={list} colw={colw} wrapW={wrapW} virtual={virtual} scrollEl={wrapRef} />
      </div>
    )
  }
  return (
    <div className="gridwrap" ref={wrapRef}>
      {trashHeader}
      {guide}
      <Waterfall items={list} colw={colw} wrapW={wrapW} virtual={virtual} scrollEl={wrapRef} />
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
          <Card key={a.id} a={a} view="list" />
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
            <Card a={items[vi.index]} view="list" />
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
          <Card key={a.id} a={a} view="grid" />
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
                  <Card a={a} view="grid" />
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
          <Card key={a.id} a={a} view="waterfall" />
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
            <Card a={items[vi.index].a} view="waterfall" />
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
