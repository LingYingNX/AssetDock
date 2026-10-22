import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { queryLightboxAssets } from '../data/query'
import type { Asset } from '../data/types'
import { REEL_WINDOW_THRESHOLD, scrollLeftForIndex, stripWindow } from '../data/strip-window'
import { Icon } from './Icons'

/** 位图走缓存缩略图,视频直接抽首帧,三维与样式表使用类型格。 */
function stripSrc(a: Asset): string | null {
  if (a.type !== 'image' && a.type !== 'video') return null
  if (a.type === 'video') {
    return a.dbId != null ? (a.originalUrl ?? null) : (a.previewUrl ? `/@fs/${a.previewUrl}` : null)
  }
  if (a.dbId != null) {
    // 灯箱用的是 media:// 的缩略图变体(&thumb=1 指向 640px JPEG 缓存)
    return a.previewUrl ?? null
  }
  return a.previewUrl ? `/@fs/${a.previewUrl}` : null
}

const TYPE_ICON: Record<Asset['type'], string> = {
  image: 'image',
  video: 'play',
  model: 'cube',
  style: 'code'
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
  const stripColor = useUI((s) => s.stripColor)
  const openLightbox = useUI((s) => s.openLightbox)
  const trackRef = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewport, setViewport] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startLeft: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  /* 与网格同口径:灯箱里翻的是「当前文件夹/当前筛选」这一串,而不是整个库。
     但右键从别处打开、或筛选条件刚变时,当前素材可能不在这一串里——
     那时退回「全库未删除」,免得胶片带上一个都不高亮、看着像坏了。 */
  const visible = useMemo(
    () => queryLightboxAssets(assets, { nav, search, filters, stripColor }, lightboxId),
    [assets, nav, search, filters, stripColor, lightboxId]
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

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [lightboxId])

  if (!lightboxId || visible.length === 0) return null

  const win = windowed
    ? stripWindow(scrollLeft, viewport, visible.length)
    : { start: 0, end: visible.length, padLeft: 0, padRight: 0 }
  const slice = visible.slice(win.start, win.end)

  return (
    <div className="pv-stripbar">
      <div className="pv-striprail">
        <div
          className={`pv-striptrack${dragging ? ' dragging' : ''}`}
          ref={trackRef}
          role="listbox"
          aria-label="素材胶片带"
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startLeft: e.currentTarget.scrollLeft, moved: false }
            setDragging(true)
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current
            if (!drag) return
            const dx = e.clientX - drag.startX
            if (!drag.moved && Math.abs(dx) > 4) drag.moved = true
            if (drag.moved) {
              e.preventDefault()
              if (!e.currentTarget.hasPointerCapture(drag.pointerId)) e.currentTarget.setPointerCapture(drag.pointerId)
              e.currentTarget.scrollLeft = drag.startLeft - dx
            }
          }}
          onPointerUp={(e) => {
            const drag = dragRef.current
            if (drag?.moved) {
              suppressClickRef.current = true
              window.setTimeout(() => { suppressClickRef.current = false }, 0)
            }
            dragRef.current = null
            setDragging(false)
            if (drag && e.currentTarget.hasPointerCapture(drag.pointerId)) e.currentTarget.releasePointerCapture(drag.pointerId)
          }}
          onPointerCancel={() => {
            dragRef.current = null
            setDragging(false)
          }}
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
                  if (suppressClickRef.current || on) return
                  e.stopPropagation()
                  openLightbox(a.id)
                }}
              >
                {src && a.type === 'video' && !on ? (
                  <video
                    className="pv-reel-video"
                    src={src}
                    muted
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const video = e.currentTarget
                      if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 10)
                    }}
                  />
                ) : src && a.type === 'image' ? (
                  <img src={src} alt="" draggable={false} />
                ) : (
                  <span className={`pv-reel-fallback ${a.type}`}>
                    <Icon name={TYPE_ICON[a.type]} />
                    <span>{a.format}</span>
                  </span>
                )}
                {src ? <span className="pv-reel-format">{a.format}</span> : null}
              </button>
            )
          })}
          {win.padRight > 0 ? <span className="pv-strip-pad" style={{ width: win.padRight }} aria-hidden="true" /> : null}
        </div>
      </div>
    </div>
  )
}
