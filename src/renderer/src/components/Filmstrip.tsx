import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { queryAssets } from '../data/query'
import type { Asset } from '../data/types'
import { REEL_WINDOW_THRESHOLD, scrollLeftForIndex, stripWindow } from '../data/strip-window'

/** 胶片带的可用元素:视频/图片/模型都能给出一张缩略图,样式表(CSS)没有位图 */
function stripSrc(a: Asset): string | null {
  if (a.type === 'style') return null
  if (a.dbId != null) {
    // 灯箱用的是 media:// 的缩略图变体(&thumb=1 指向 640px JPEG 缓存)
    return a.previewUrl ?? null
  }
  return a.previewUrl ? `/@fs/${a.previewUrl}` : null
}

const TYPE_MARK: Record<Asset['type'], string> = {
  image: '',
  video: '▶',
  model: '◈',
  style: '{}'
}

/**
 * 底部胶片传送带:横向列出「当前视图」的素材(与网格同一套 nav/搜索/筛选口径),
 * 点击即切换。
 *
 * 只呈现缩略图与类型角标,名字放在左端一处——每格都写名字会挤成噪声。
 *
 * 素材多时只渲染视口附近的一段(见 data/strip-window.ts):实测 4105 个素材里
 * 可见的仅 9 个,全量渲染等于白造 4000+ 节点。两侧用占位块撑出总宽度。
 */
export function Filmstrip(): React.JSX.Element | null {
  const lightboxId = useUI((s) => s.lightboxId)
  const assets = useUI((s) => s.assets)
  const nav = useUI((s) => s.nav)
  const search = useUI((s) => s.search)
  const filters = useUI((s) => s.filters)
  const swatches = useUI((s) => s.swatches)
  const stripColor = useUI((s) => s.stripColor)
  const openLightbox = useUI((s) => s.openLightbox)
  const trackRef = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewport, setViewport] = useState(0)

  /* 与网格同口径:灯箱里翻的是「当前文件夹/当前筛选」这一串,而不是整个库。
     但右键从别处打开、或筛选条件刚变时,当前素材可能不在这一串里——
     那时退回「全库未删除」,免得胶片带上一个都不高亮、看着像坏了。 */
  const scoped = useMemo(
    () => queryAssets(assets, { nav, search, filters, swatches, stripColor }),
    [assets, nav, search, filters, swatches, stripColor]
  )
  const visible = useMemo(
    () => (scoped.some((a) => a.id === lightboxId) ? scoped : assets.filter((a) => !a.deletedAt)),
    [scoped, assets, lightboxId]
  )
  const idx = visible.findIndex((a) => a.id === lightboxId)
  const windowed = visible.length > REEL_WINDOW_THRESHOLD

  /* 视口宽度:窗口缩放后窗口区间要跟着重算,否则右端会露出空白 */
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewport(el.clientWidth))
    ro.observe(el)
    setViewport(el.clientWidth)
    setScrollLeft(el.scrollLeft)
    return () => ro.disconnect()
  }, [lightboxId])

  /* 换素材时把当前格滚进视野。
     这里原本是两套滚动语言:未窗口化走 scrollIntoView(瞬时定位到最近边缘),
     窗口化走 scrollLeftForIndex + scrollTo({behavior:'smooth'})——同一个胶片带
     在小库和大库下的动法与落点都不一样,小库翻片是硬跳。
     现在统一走「自己算目标位置 + 平滑滚动」:算出来的目标不依赖 DOM 节点是否存在,
     窗口化下未挂载的格子照样能定位,这本来也是原注释里不能用 scrollIntoView 的理由。
     落点沿用窗口化分支原有的居中策略(有测试覆盖的 scrollLeftForIndex),
     即两套语言里设计得更明确的那一套。
     reduced-motion 下退回瞬时:用户明确要求少动,不该由这行代码替它决定滑过去。 */
  useEffect(() => {
    if (idx < 0) return
    const el = trackRef.current
    if (!el) return
    const target = scrollLeftForIndex(idx, el.clientWidth, visible.length)
    // 目标已在视野内就不动:连续翻片时画面不该来回跳
    if (Math.abs(target - el.scrollLeft) < 1) return
    el.scrollTo({
      left: target,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    })
  }, [idx, windowed, visible.length])

  if (!lightboxId || visible.length === 0) return null

  const win = windowed
    ? stripWindow(scrollLeft, viewport, visible.length)
    : { start: 0, end: visible.length, padLeft: 0, padRight: 0 }
  const slice = visible.slice(win.start, win.end)

  const cur = visible[idx]

  return (
    <div className="pv-stripbar">
      <div className="pv-stripmeta">
        <span className="name-b" title={cur?.name}>{cur?.name ?? ''}</span>
        <span className="sub">
          {idx + 1} / {visible.length}
        </span>
      </div>
      <div
        className="pv-striptrack"
        ref={trackRef}
        role="listbox"
        aria-label="素材胶片带"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      >
        {win.padLeft > 0 ? <span className="pv-strip-pad" style={{ width: win.padLeft }} aria-hidden="true" /> : null}
        {slice.map((a, i) => {
          const real = win.start + i
          const src = stripSrc(a)
          const on = real === idx
          return (
            <button
              key={a.id}
              data-strip-index={real}
              className={`pv-reel${on ? ' on' : ''}`}
              role="option"
              aria-selected={on}
              aria-label={a.name}
              title={a.name}
              onClick={(e) => {
                // 已在当前图时不重复打开:避免无谓地重建播放状态
                if (on) return
                e.stopPropagation()
                openLightbox(a.id)
              }}
            >
              {src ? (
                <img src={src} alt="" draggable={false} />
              ) : (
                <span className="pv-reel-blank">{TYPE_MARK[a.type] || a.format}</span>
              )}
              {a.type === 'video' ? <span className="pv-reel-mark">▶</span> : null}
            </button>
          )
        })}
        {win.padRight > 0 ? <span className="pv-strip-pad" style={{ width: win.padRight }} aria-hidden="true" /> : null}
      </div>
    </div>
  )
}
