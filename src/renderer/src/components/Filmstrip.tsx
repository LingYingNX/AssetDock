import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { queryLightboxAssets } from '../data/query'
import type { Asset } from '../data/types'
import {
  REEL_GAP,
  REEL_PITCH,
  REEL_W,
  REEL_WINDOW_THRESHOLD,
  scrollLeftForIndex,
  stripWindow
} from '../data/strip-window'
import { Icon } from './Icons'

/** 位图走缓存缩略图,视频直接抽首帧,三维与样式表使用类型格。 */
function stripSrc(a: Asset): string | null {
  if (a.type !== 'image' && a.type !== 'video' && a.type !== 'document') return null
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
  style: 'code',
  document: 'document'
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
  const stripOpen = useUI((s) => s.stripOpen)
  const toggleStrip = useUI((s) => s.toggleStrip)
  const trackRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewport, setViewport] = useState(0)
  const [scrollWidth, setScrollWidth] = useState(0)
  /* 实测格宽与间距:CSS 里的 .pv-reel 宽度会被窄屏容器查询改掉,
     常量只是兜底。滚动定位必须用实测值,否则每格累积偏差,
     当前素材就永远不在中间。 */
  const [metrics, setMetrics] = useState({ pitch: REEL_PITCH, itemW: REEL_W, gap: REEL_GAP })
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
  /* 首尾格也要能滚到正中间:两端各留出「半个视口减半个格子」的空白。
     末格还多一条 margin-right,所以尾部按 gap 修正,否则会偏右半个间距。 */
  const centerStart = Math.max(0, (viewport - metrics.itemW) / 2)
  const centerEnd = Math.max(0, (viewport - metrics.itemW - metrics.gap * 2) / 2)

  /* 视口宽度:窗口缩放后窗口区间要跟着重算,否则右端会露出空白 */
  useLayoutEffect(() => {
    const el = trackRef.current
    if (!el) return
    const measure = (): void => {
      setViewport(el.clientWidth)
      setScrollWidth(el.scrollWidth)
      const reel = el.querySelector<HTMLElement>('.pv-reel')
      if (!reel) return
      const itemW = reel.getBoundingClientRect().width
      const gap = parseFloat(getComputedStyle(reel).marginRight) || 0
      setMetrics((m) => (m.pitch === itemW + gap && m.itemW === itemW ? m : { pitch: itemW + gap, itemW, gap }))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    setScrollLeft(el.scrollLeft)
    return () => ro.disconnect()
  }, [lightboxId, visible.length])

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
    const target = scrollLeftForIndex(
      idx,
      el.clientWidth,
      visible.length,
      metrics.pitch,
      metrics.itemW,
      centerStart,
      centerEnd
    )
    // 目标已在视野内就不动:连续翻片时画面不该来回跳
    if (Math.abs(target - el.scrollLeft) < 1) return
    el.scrollTo({
      left: target,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    })
  }, [idx, windowed, visible.length, metrics.pitch, metrics.itemW, centerStart, centerEnd])

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
    ? stripWindow(scrollLeft, viewport, visible.length, metrics.pitch, undefined, centerStart, centerEnd)
    : { start: 0, end: visible.length, padLeft: centerStart, padRight: centerEnd }
  const slice = visible.slice(win.start, win.end)

  /* 抽屉:底边常驻一条握把,胶片带从握把上方滑出/收回。
     握把是唯一的开关,收起时右侧仍写「第几张/共几张」,不至于失去方位。 */
  return (
    <div className={`pv-stripbar${stripOpen ? ' open' : ''}`}>
      <button
        className="pv-strip-grab"
        title={stripOpen ? '收起胶片带' : '展开胶片带'}
        aria-label={stripOpen ? '收起胶片带' : '展开胶片带'}
        aria-expanded={stripOpen}
        onClick={toggleStrip}
      >
        <span className="pv-strip-grip" aria-hidden="true" />
        {stripOpen ? null : <span className="pv-strip-pos">{idx + 1} / {visible.length}</span>}
      </button>
      <div className="pv-striprail" ref={railRef}>
        <StripSlider
          rail={railRef}
          scrollLeft={scrollLeft}
          viewport={viewport}
          scrollWidth={scrollWidth}
          onSeek={(value) => {
            const el = trackRef.current
            if (!el) return
            el.scrollLeft = value
            setScrollLeft(el.scrollLeft)
          }}
        />
        <div
          id="pv-strip-track"
          className={`pv-striptrack${dragging ? ' dragging' : ''}`}
          style={{ paddingLeft: 0, paddingRight: 0 }}
          ref={trackRef}
          role="listbox"
          aria-label="素材胶片带"
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          onKeyDown={(event) => {
            if (visible.length === 0) return
            const track = event.currentTarget
            const active = document.activeElement as HTMLElement | null
            const current = active?.dataset.stripIndex != null ? Number(active.dataset.stripIndex) : -1
            const next = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? visible.length - 1
                : event.key === 'ArrowLeft'
                  ? (current <= 0 ? 0 : current - 1)
                  : event.key === 'ArrowRight'
                    ? (current < 0 ? 0 : Math.min(visible.length - 1, current + 1))
                    : null
            if (next == null) return
            event.preventDefault()
            event.stopPropagation()
            const focusIndex = (index: number): boolean => {
              const target = track.querySelector<HTMLElement>(`[data-strip-index="${index}"]`)
              if (!target) return false
              target.focus()
              return true
            }
            if (focusIndex(next)) return
            /* 目标格还没挂载:先滚进窗口,等虚拟切片更新后再聚焦 */
            track.scrollLeft = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? track.scrollWidth
                : current < 0
                  ? 0
                  : track.scrollLeft + Math.sign(next - current) * metrics.pitch
            let attempts = 0
            const focusWhenMounted = (): void => {
              if (focusIndex(next) || attempts++ > 20) return
              requestAnimationFrame(focusWhenMounted)
            }
            requestAnimationFrame(focusWhenMounted)
          }}
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
          {/* 占位块宽度必须写成整数字符串:padLeft/padRight 可能上百万,
              React 会把大数转成 "1.5428e+06px",浏览器解析不了这个记法,
              占位块会按内容宽渲染,整个轨道的布局就此错位。 */}
          {win.padLeft > 0 ? <span className="pv-strip-pad" style={{ width: `${Math.round(win.padLeft)}px` }} aria-hidden="true" /> : null}
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
                tabIndex={on ? 0 : -1}
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
                    aria-hidden="true"
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const video = e.currentTarget
                      if (video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 10)
                    }}
                  />
                ) : src && (a.type === 'image' || a.type === 'document') ? (
                  <img src={src} alt="" width={96} height={56} draggable={false} />
                ) : (
                  <span className={`pv-reel-fallback ${a.type}`}>
                    <Icon name={TYPE_ICON[a.type]} />
                  </span>
                )}
              </button>
            )
          })}
          {win.padRight > 0 ? <span className="pv-strip-pad" style={{ width: `${Math.round(win.padRight)}px` }} aria-hidden="true" /> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * 自绘的细滑块:原生滚动条会吃掉轨道高度并压矮缩略图,
 * 这里用 2px 的条叠在轨道底边表示位置,可拖拽定位。
 */
function StripSlider({
  rail,
  scrollLeft,
  viewport,
  scrollWidth,
  onSeek
}: {
  rail: React.RefObject<HTMLDivElement | null>
  scrollLeft: number
  viewport: number
  scrollWidth: number
  onSeek: (value: number) => void
}): React.JSX.Element | null {
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState(false)

  useLayoutEffect(() => {
    const el = rail.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [rail])

  const maxScroll = Math.max(1, scrollWidth - viewport)
  const ratio = viewport / Math.max(1, scrollWidth)
  const thumbW = Math.max(24, Math.round(width * ratio))
  const thumbLeft = Math.round((scrollLeft / maxScroll) * Math.max(0, width - thumbW))

  const seekFromClientX = (clientX: number): void => {
    const el = rail.current
    if (!el || width <= 0) return
    const rect = el.getBoundingClientRect()
    const ratioX = Math.min(1, Math.max(0, (clientX - rect.left - thumbW / 2) / Math.max(1, width - thumbW)))
    onSeek(ratioX * maxScroll)
  }

  return (
    <div
      className={`pv-stripslider${dragging ? ' dragging' : ''}`}
      style={{ width: `${thumbW}px`, transform: `translateX(${thumbLeft}px)` }}
      role="scrollbar"
      aria-label="素材胶片带滚动条"
      aria-orientation="horizontal"
      aria-controls="pv-strip-track"
      aria-valuetext={`${Math.round(scrollLeft)} / ${maxScroll} 像素`}
      aria-valuemin={0}
      aria-valuemax={maxScroll}
      aria-valuenow={Math.round(scrollLeft)}
      tabIndex={0}
      onKeyDown={(event) => {
        const step = 40
        const next = event.key === 'ArrowLeft'
          ? Math.max(0, scrollLeft - step)
          : event.key === 'ArrowRight'
            ? Math.min(maxScroll, scrollLeft + step)
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? maxScroll
                : null
        if (next == null) return
        event.preventDefault()
        event.stopPropagation()
        onSeek(next)
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
        seekFromClientX(e.clientX)
      }}
      onPointerMove={(e) => {
        if (!dragging) return
        seekFromClientX(e.clientX)
      }}
      onPointerUp={(e) => {
        setDragging(false)
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => setDragging(false)}
    />
  )
}
