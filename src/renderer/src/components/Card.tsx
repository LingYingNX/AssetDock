import { useEffect, useRef, useState } from 'react'
import { isPreviewDecoded, markPreviewDecoded } from '../data/preview-cache'
import { useUI } from '../store/ui'
import { formatBytes, formatRelativeDate, formatResolution } from '../data/query'
import { thumbRatio, MAX_THUMB_AR } from '../data/thumb-ratio'
import { onceInView } from '../data/viewport'
import type { Asset } from '../data/types'
import { MEDIA_ASSETS_DRAG_TYPE, encodeAssetDrag } from '../data/asset-drag'
import { Icon } from './Icons'
import { Cube3D } from './Cube3D'
import { LazyViewer3D } from './LazyViewer3D'
/** 视频/三维格式徽章圆点颜色(规格第 10 节) */
const FORMAT_DOT: Partial<Record<Asset['format'], string>> = {
  MP4: '#3B82F6',
  MOV: '#F97316',
  PSD: '#8B5CF6',
  GLB: '#22D3EE',
  FBX: '#22D3EE',
  OBJ: '#22D3EE'
}

function dragPreview(count: number): HTMLDivElement {
  const preview = document.createElement('div')
  preview.className = 'asset-drag-preview'
  preview.innerHTML = `<span class="asset-drag-icon"></span><strong>${count}</strong>`
  document.body.appendChild(preview)
  return preview
}

export function Card({ a, view, selectionOrder }: { a: Asset; view: string; selectionOrder?: string[] }): React.JSX.Element {
  const selected = useUI((s) => s.selectedSet.has(a.id))
  const clickCard = useUI((s) => s.clickCard)
  const selectOnly = useUI((s) => s.selectOnly)
  const openLightbox = useUI((s) => s.openLightbox)
  const lightboxId = useUI((s) => s.lightboxId)
  const setFocusedCard = useUI((s) => s.setFocusedCard)
  const setCtxMenu = useUI((s) => s.setCtxMenu)
  const toggleFavorite = useUI((s) => s.toggleFavorite)
  // 已解码过的预览直接以可见态挂载:切换文件夹时卡片会重挂载,
  // 若从 opacity:0 重新淡入,用户看到的就是缩略图重新刷新。
  const previewKey = a.previewUrl ?? ''
  const [imgLoaded, setImgLoaded] = useState(() => isPreviewDecoded(previewKey))
  const [modelFailed, setModelFailed] = useState(false)
  /** 视频卡悬浮进度:读实时播放进度,避免所有视频卡都画同一条假进度条 */
  const [progress, setProgress] = useState(0)
  /** 悬浮重播时的短溶解,替掉尾帧→首帧的硬切 */
  const [dip, setDip] = useState(false)
  const dragPreviewRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  /**
   * 视频与三维只在卡片进过视口后才挂载：
   * `<video>` 没有原生的懒加载，三维卡挂载即建 WebGL 上下文，两者都会在
   * 千级素材库里凭「存在」就吃掉带宽或上下文配额。图片走原生 `loading="lazy"`。
   */
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = thumbRef.current
    if (!el) return
    return onceInView(el, () => setInView(true))
  }, [])
  // 列表/网格悬浮自动播放偏好(设置 → 音视频);默认开启,静音默认开启
  const hoverVideo = useUI((s) => s.hoverVideo)
  const hoverSound = useUI((s) => s.hoverSound)

  const cls = [
    'card',
    a.type === 'video' ? 'video' : '',
    a.type === 'model' ? 'c3d' : '',
    selected ? 'is-selected' : '',
    `glass-card`
  ]
    .filter(Boolean)
    .join(' ')

  // 比例走 thumbRatio 收敛,不再直接把原始 width/height 交给 CSS:
  // 1200x172 这类极端比例会让缩略图矮成一条线,统一在这里收口。
  const ratio = thumbRatio(a.width, a.height)
  const ar = view === 'grid' || a.type === 'model' || ratio == null ? undefined : ratio.toFixed(4)

  // 收敛之后的容器比例最宽只到 21:9,而原始比例可能到 7:1(1200x172 的字幕/长条渲染图)。
  // 这种素材在 cover 下会被裁掉大半宽度,4:3 的网格视图里只剩中间约 19%,主体全丢。
  // 这里按「原始比例超出容器上界」判定,给缩略图挂 .uw 走 contain:
  // 留白虽不美,但细长条素材本来就该整条可见。列表视图的缩略图是固定 96x58 的小图,
  // 本身就该 cover,不参与这个判定。
  const rawAr = a.width && a.height ? a.width / a.height : undefined
  const ultraWide = view !== 'list' && rawAr != null && rawAr > MAX_THUMB_AR

  const meta =
    a.type === 'model' || a.type === 'style'
      ? [formatBytes(a.sizeBytes)]
      : [formatResolution(a), formatBytes(a.sizeBytes)]

  const isVideo = a.type === 'video'
  const canMove = a.dbId != null && a.libraryId != null && !a.missing && !a.deletedAt

  return (
    <figure
      className={cls}
      data-asset-id={a.id}
      tabIndex={0}
      draggable={canMove}
      onDragStart={(e) => {
        if (!canMove) {
          e.preventDefault()
          return
        }
        const state = useUI.getState()
        const ids = selected
          ? state.selectedIds.filter((id) => {
            const asset = state.assets.find((item) => item.id === id)
            return asset != null && asset.dbId != null && asset.libraryId === a.libraryId && !asset.missing && !asset.deletedAt
          })
          : [a.id]
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(MEDIA_ASSETS_DRAG_TYPE, encodeAssetDrag(ids))
        e.dataTransfer.setData('text/plain', encodeAssetDrag(ids))
        const preview = dragPreview(ids.length)
        dragPreviewRef.current?.remove()
        dragPreviewRef.current = preview
        e.dataTransfer.setDragImage(preview, 22, 18)
        // 拖拽预览只为 setDragImage 而存在;拖动结束由 onDragEnd 清理。
        // 这里只兜底:若 dragend 因外部原因没来(拖出窗口等),1s 后也收掉。
        window.setTimeout(() => {
          if (dragPreviewRef.current !== preview) return
          preview.remove()
          dragPreviewRef.current = null
        }, 1000)
      }}
      onDragEnd={() => {
        dragPreviewRef.current?.remove()
        dragPreviewRef.current = null
      }}
      aria-label={`${a.name}.${a.format.toLowerCase()}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.qa')) return
        // 无修饰键单选，Shift 区间，Ctrl/Cmd 逐张 toggle
        clickCard(a.id, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey, order: selectionOrder })
      }}
      onDoubleClick={(e) => {
        openLightbox(a.id)
      }}
      onFocus={() => setFocusedCard(a.id)}
      onMouseEnter={() => {
        // 悬浮自动播放:仅在偏好开启且为视频时启动。
        // 进入前先退回首帧并淡化,否则从尾帧硬切到第 0 帧会闪一下。
        const v = videoRef.current
        if (!v || !hoverVideo) return
        // 先落到底再抬起透明度:从上一轮的尾帧跳到第 0 帧是硬切,
        // 借 140ms 的透明度回落做一次溶解,替掉那一帧突跳。
        setDip(true)
        v.currentTime = 0
        void v.play().catch(() => { /* 自动播放被拦截时保持首帧 */ })
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(() => setDip(false))
        )
      }}
      onMouseLeave={() => {
        const v = videoRef.current
        if (!v) return
        // 离开即复位:暂停并把播放头退回首帧,下次进入仍从开头播
        v.pause()
        v.currentTime = 0
        setProgress(0)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        // 右键先选中被点的素材：已在选区内则保留整组(菜单仍作用于整组)，
        // 不在选区内则替换为该张，检查器随之切换。
        if (!useUI.getState().selectedSet.has(a.id)) selectOnly(a.id)
        setCtxMenu({ x: e.clientX, y: e.clientY, assetId: a.id })
      }}
    >
      <div
        className={`thumb${a.thumbClass ? ` ${a.thumbClass}` : ''}${ultraWide ? ' uw' : ''}`}
        style={ar ? ({ ['--ar' as string]: ar } as React.CSSProperties) : undefined}
        role="img"
        ref={thumbRef}
        aria-label={`${a.type === 'model' ? '三维模型' : a.type === 'video' ? '视频' : a.type === 'style' ? '样式表' : '图片'}缩略图:${a.name}`}
      >
        {a.type === 'model' && a.dbId == null ? (
          inView && lightboxId !== a.id ? (
            <div className="c3d-wrap">
              <Cube3D cs="58px" />
            </div>
          ) : null
        ) : a.type === 'model' && a.originalUrl && !modelFailed ? (
          inView && lightboxId !== a.id ? (
            <div className="model-card-preview">
              <LazyViewer3D
                url={a.originalUrl}
                format={a.format as 'GLB' | 'FBX' | 'OBJ'}
                turntable
                wireframe={false}
                view="auto"
                onError={() => setModelFailed(true)}
              />
            </div>
          ) : null
        ) : a.dbId != null && (a.type === 'image' || a.type === 'style') ? (
          <img
            src={a.previewUrl}
            alt={a.name}
            loading="lazy"
            decoding="async"
            className={imgLoaded ? 'loaded' : ''}
            onLoad={() => { setImgLoaded(true); markPreviewDecoded(previewKey) }}
            draggable={false}
          />
        ) : a.dbId != null && isVideo ? (
          inView && lightboxId !== a.id ? (
            <video
              ref={videoRef}
              /* 视频必须读原图:previewUrl 指向缩略图缓存,不能用于解码播帧 */
              src={a.originalUrl}
              muted={hoverSound !== true}
              /* 只预载元数据:挂载时取头部拿到首帧即可,整片留给悬浮播放与灯箱 */
              preload="metadata"
              className={`${imgLoaded ? 'loaded' : ''}${dip ? ' dip' : ''}`}
              onLoadedData={() => { setImgLoaded(true); markPreviewDecoded(previewKey) }}
              onLoadedMetadata={() => { setImgLoaded(true); markPreviewDecoded(previewKey) }}
              onTimeUpdate={(e) => {
                const v = e.currentTarget
                if (v.duration > 0) setProgress((v.currentTime / v.duration) * 100)
              }}
            />
          ) : null
        ) : a.previewUrl && (a.type === 'image' || a.type === 'style') ? (
          <img
            src={`/@fs/${a.previewUrl}`}
            alt={a.name}
            loading="lazy"
            decoding="async"
            className={imgLoaded ? 'loaded' : ''}
            onLoad={() => { setImgLoaded(true); markPreviewDecoded(previewKey) }}
            draggable={false}
          />
        ) : a.previewUrl && isVideo ? (
          inView && lightboxId !== a.id ? (
            <video
              ref={videoRef}
              src={`/@fs/${a.previewUrl}`}
              muted={hoverSound !== true}
              preload="metadata"
              className={`${imgLoaded ? 'loaded' : ''}${dip ? ' dip' : ''}`}
              onLoadedMetadata={() => { setImgLoaded(true); markPreviewDecoded(previewKey) }}
              onTimeUpdate={(e) => {
                const v = e.currentTarget
                if (v.duration > 0) setProgress((v.currentTime / v.duration) * 100)
              }}
            />
          ) : null
        ) : null}

        <div className="qa">
          <button
            className={`fav${a.favorite ? ' on' : ''}`}
            title="收藏"
            onClick={(e) => {
              e.stopPropagation()
              toggleFavorite(a.id)
            }}
          >
            <Icon name="heart" />
          </button>
        </div>
        {isVideo && (
          <>
            <span className="play-big"><Icon name="play" /></span>
            <div className="scrub"><i style={{ width: `${progress}%` }} /></div>
          </>
        )}
        <span className="type-chip">
          {FORMAT_DOT[a.format] ? (
            <span className="dot" style={{ background: FORMAT_DOT[a.format] }} />
          ) : null}
          {a.format}
        </span>
        {isVideo && a.duration ? <span className="dur">{a.duration}</span> : null}
      </div>
      <figcaption>
        <div className="name-row"><span className="name">{a.name}</span></div>
        <div className="meta-row">
          <span>{meta[0]}</span>
          {meta[1] ? (
            <>
              <span className="sep2">·</span>
              <span>{meta[1]}</span>
            </>
          ) : null}
        </div>
        <span className="lc lc-type">{a.format}</span>
        <span className="lc lc-res">{a.type === 'model' ? '三维' : a.type === 'style' ? '样式' : formatResolution(a)}</span>
        <span className="lc lc-size">{formatBytes(a.sizeBytes)}</span>
        <span className="lc lc-dur">{isVideo ? (a.duration ?? '—') : '—'}</span>
        <span className="lc lc-date">{formatRelativeDate(a.importedAt)}</span>
        <span className="lc lc-acts">
          {/* 原来这个「更多」按钮没有 onClick,点下去什么也不会发生;
              列表视图已有右键菜单,这里直接打开同一份菜单。 */}
          <button
            title="更多操作"
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              setCtxMenu({ x: r.left, y: r.bottom + 4, assetId: a.id })
            }}
          >
            <Icon name="more-h" />
          </button>
        </span>
      </figcaption>
    </figure>
  )
}
