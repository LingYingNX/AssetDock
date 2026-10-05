import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../store/ui'
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
 * 底部胶片传送带:横向列出当前视图的素材,点击即切换。
 *
 * 只呈现缩略图与类型角标,不放文件名——一排名字会挤成噪声,名字在上方标题区已有。
 *
 * 素材多时只渲染视口附近的一段(见 data/strip-window.ts):实测 4105 个素材里
 * 可见的仅 9 个,全量渲染等于白造 4000+ 节点。两侧用占位块撑出总宽度,滚动条不变。
 */
export function Filmstrip(): React.JSX.Element | null {
  const lightboxId = useUI((s) => s.lightboxId)
  const assets = useUI((s) => s.assets)
  const openLightbox = useUI((s) => s.openLightbox)
  const trackRef = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewport, setViewport] = useState(0)

  const visible = useMemo(() => assets.filter((a) => !a.deletedAt), [assets])
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

  /* 换素材时把当前项滚到视野中间。
     不能用 scrollIntoView:窗口化后目标格可能还没挂载,查不到节点。
     直接算目标滚动位置,再同步一次状态让区间跟上。 */
  useEffect(() => {
    if (idx < 0) return
    const el = trackRef.current
    if (!el) return
    if (!windowed) {
      const node = el.querySelector<HTMLElement>(`[data-strip-index="${idx}"]`)
      node?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      return
    }
    const target = scrollLeftForIndex(idx, el.clientWidth, visible.length)
    // 目标已在视野内就不动:连续翻片时画面不该来回跳
    if (target >= el.scrollLeft - 1 && target <= el.scrollLeft + 1) return
    el.scrollTo({ left: target, behavior: 'smooth' })
  }, [idx, windowed, visible.length])

  if (!lightboxId || visible.length === 0) return null

  const win = windowed
    ? stripWindow(scrollLeft, viewport, visible.length)
    : { start: 0, end: visible.length, padLeft: 0, padRight: 0 }
  const slice = visible.slice(win.start, win.end)

  return (
    <div className="pv-stripbar">
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
      <span className="pv-stripcount">
        {idx + 1} / {visible.length}
      </span>
    </div>
  )
}
