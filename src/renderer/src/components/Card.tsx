import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isPreviewDecoded, markPreviewDecoded } from '../data/preview-cache'
import { useUI } from '../store/ui'
import { formatBytes, formatRelativeDate, formatResolution } from '../data/query'
import { thumbRatio, MAX_THUMB_AR, MIN_THUMB_AR } from '../data/thumb-ratio'
import type { Asset } from '../data/types'
import { MEDIA_ASSETS_DRAG_TYPE, downloadUrlForPath, encodeAssetDrag } from '../data/asset-drag'
import { Icon } from './Icons'
import { Cube3D } from './Cube3D'
import { formatSpec } from '../../../shared/formats'
import { onceInView } from '../data/viewport'
function documentStructure(a: Asset): string {
  const spec = formatSpec(a.format)
  const shape = spec && 'documentShape' in spec ? spec.documentShape : undefined
  if (shape === 'sheet') {
    return a.sheetCount != null ? `${a.sheetCount} 个工作表` : '—'
  }
  if (shape === 'slides') {
    return a.slideCount != null ? `${a.slideCount} 张幻灯片` : '—'
  }
  return a.pageCount != null ? `${a.pageCount} 页` : '—'
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
  /* 选中块里共享边只由下面那行画,避免上下两圈描边在接缝叠粗 */
  const selEnd = useUI((s) => {
    const order = selectionOrder
    const i = order ? order.indexOf(a.id) : -1
    return !order || i < 0 || i === order.length - 1 || !s.selectedSet.has(order[i + 1])
  })
  const clickCard = useUI((s) => s.clickCard)
  const selectOnly = useUI((s) => s.selectOnly)
  const openLightbox = useUI((s) => s.openLightbox)
  const thumbRevision = useUI((s) => a.fingerprint ? (s.thumbRevisions[a.fingerprint] ?? 0) : 0)
  const setFocusedCard = useUI((s) => s.setFocusedCard)
  const setCtxMenu = useUI((s) => s.setCtxMenu)
  const disp = useUI((s) => s.display)
  const renaming = useUI((s) => s.renaming)
  const activeId = useUI((s) => s.activeId)
  const renameAsset = useUI((s) => s.renameAsset)
  const setRenaming = useUI((s) => s.setRenaming)
  // 已解码过的预览直接以可见态挂载:切换文件夹时卡片会重挂载,
  // 若从 opacity:0 重新淡入,用户看到的就是缩略图重新刷新。
  const previewKey = a.previewUrl ?? ''
  const thumbSrc = a.previewUrl
    ? `${a.previewUrl}${a.previewUrl.includes('?') ? '&' : '?'}thumbReady=${thumbRevision}`
    : ''
  const hasCardThumb = !(a.deletedAt && (a.type === 'video' || a.type === 'model'))
  const previewSrc = a.previewUrl && hasCardThumb
    ? (a.dbId != null ? thumbSrc : `/@fs/${a.previewUrl}`)
    : ''
  const [imgLoaded, setImgLoaded] = useState(() => isPreviewDecoded(previewKey))
  /* GIF 缩略图是静态帧,悬停时换成原图让浏览器播动画;离开即卸载,停掉解码与合成 */
  const [gifLive, setGifLive] = useState(false)
  const [zoom, setZoom] = useState<{ left: number; top: number; width: number; origin: string; open: boolean } | null>(null)
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /* 原图没解码完就换上会先闪一下空框,解码完再显形 */
  const [gifReady, setGifReady] = useState(false)
  const [inView, setInView] = useState(false)
  const cardRef = useRef<HTMLElement | null>(null)
  const dragPreviewRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    return onceInView(card, () => setInView(true))
  }, [])

  const cls = [
    'card',
    a.type === 'video' ? 'video' : '',
    a.type === 'model' ? 'c3d' : '',
    selected ? 'is-selected' : '',
    selected && selEnd ? 'sel-end' : '',
    disp.name ? '' : 'no-name',
    `glass-card`
  ]
    .filter(Boolean)
    .join(' ')

  // 比例走 thumbRatio 收敛,不再直接把原始 width/height 交给 CSS:
  // 1200x172 这类极端比例会让缩略图矮成一条线,统一在这里收口。
  const ratio = thumbRatio(a.width, a.height)
  const ar = view === 'grid' || a.type === 'model' || ratio == null ? undefined : ratio.toFixed(4)

  // 收敛之后的容器比例限制在 [1/2, 21/9],超出这个区间的长条/长截图在 cover 下会被裁掉。
  // 这里按原始比例超出上/下界分别挂 .uw / .uh 走 contain:留白虽不美,但这类素材
  // 本来就该整条可见。列表视图的缩略图是固定 96x58 的小图,本身就该 cover,不参与判定。
  const rawAr = a.width && a.height ? a.width / a.height : undefined
  const ultraWide = view !== 'list' && rawAr != null && rawAr > MAX_THUMB_AR
  const ultraTall = view !== 'list' && rawAr != null && rawAr < MIN_THUMB_AR

  const isImage = a.type === 'image'
  const resLabel = isImage ? formatResolution(a) : ''
  const meta =
    isImage || a.type === 'model' || a.type === 'style'
      ? []
      : a.type === 'document'
        ? [documentStructure(a)]
        : [formatResolution(a)]
  const listRes =
    a.type === 'model'
      ? '三维'
      : a.type === 'style'
        ? '样式'
        : a.type === 'document'
          ? documentStructure(a)
          : formatResolution(a)
  const cardCls = cls

  const isVideo = a.type === 'video'
  const canMove = a.dbId != null && a.libraryId != null && !a.missing && !a.deletedAt

  return (
    <>
    <figure
      ref={cardRef}
      className={cardCls}
      data-asset-id={a.id}
      tabIndex={0}
      draggable={canMove}
      onDragStart={(e) => {
        if (!canMove) {
          e.preventDefault()
          return
        }
        const state = useUI.getState()
        const assetById = new Map(state.assets.map((item) => [item.id, item]))
        const ids = selected
          ? state.selectedIds.filter((id) => {
            const asset = assetById.get(id)
            return asset != null && asset.dbId != null && asset.libraryId === a.libraryId && !asset.missing && !asset.deletedAt
          })
          : [a.id]
        e.dataTransfer.effectAllowed = 'copyMove'
        e.dataTransfer.setData(MEDIA_ASSETS_DRAG_TYPE, encodeAssetDrag(ids))
        e.dataTransfer.setData('text/plain', encodeAssetDrag(ids))
        // DownloadURL 一次只能携带一个文件；多选拖出时以光标所在卡片落盘，应用内仍移动完整选区。
        const downloadUrl = a.absPath ? downloadUrlForPath(a.absPath) : null
        if (downloadUrl) e.dataTransfer.setData('DownloadURL', downloadUrl)
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
      onPointerEnter={() => { if (a.format === 'GIF' && disp.gif === 'hover') setGifLive(true) }}
      onPointerLeave={() => { setGifLive(false); setGifReady(false) }}
      onDragEnd={() => {
        dragPreviewRef.current?.remove()
        dragPreviewRef.current = null
      }}
      aria-label={`${a.name}.${a.format.toLowerCase()}${selected ? '，已选中' : ''}`}
      aria-keyshortcuts="Enter Space Shift+F10"
      onClick={(e) => {
        // 无修饰键单选，Shift 区间，Ctrl/Cmd 逐张 toggle
        clickCard(a.id, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey, order: selectionOrder })
      }}
      onDoubleClick={(e) => {
        openLightbox(a.id)
      }}
      onFocus={() => setFocusedCard(a.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          openLightbox(a.id)
          return
        }
        if (e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          selectOnly(a.id)
          return
        }
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault()
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          setCtxMenu({ x: rect.left + 12, y: rect.top + 12, assetId: a.id })
        }
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
        className={`thumb${a.thumbClass ? ` ${a.thumbClass}` : ''}${ultraWide ? ' uw' : ''}${ultraTall ? ' uh' : ''}`}
        style={ar ? ({ ['--ar' as string]: ar } as React.CSSProperties) : undefined}
        aria-hidden="true"
      >
        {inView && previewSrc ? (
          <img
            src={previewSrc}
            alt={a.name}
            width={a.width ?? undefined}
            height={a.height ?? undefined}
            loading="lazy"
            decoding="async"
            className={imgLoaded ? 'loaded' : ''}
            onLoad={() => { setImgLoaded(true); markPreviewDecoded(previewKey) }}
            draggable={false}
          />
        ) : a.type === 'model' ? (
          <div className="c3d-wrap">
            <Cube3D cs="58px" />
          </div>
        ) : null}

        {(gifLive || (disp.gif === 'auto' && inView)) && a.originalUrl ? (
          <img className={gifReady ? 'gif-live loaded' : 'gif-live'} src={a.originalUrl} alt="" draggable={false} onLoad={() => setGifReady(true)} />
        ) : null}
        {isVideo && (
          <span className="play-big"><Icon name="play" /></span>
        )}
        {isImage && disp.res && resLabel !== '—' && resLabel !== '矢量' ? <span className="res-chip">{resLabel}</span> : null}
        {disp.fmt && !disp.hiddenFormats.includes(a.format) ? <span className="fmt-chip">{a.format}</span> : null}
        {isVideo && a.duration ? <span className="dur">{a.duration}</span> : null}
        {disp.size ? <span className={'size-chip' + (isVideo && a.duration ? ' above' : '')}>{formatBytes(a.sizeBytes)}</span> : null}
        {previewSrc ? (
          <span
            className="zoom-dot"
            aria-hidden="true"
            onPointerEnter={(e) => {
              e.stopPropagation()
              const card = cardRef.current
              if (!card) return
              const r = card.getBoundingClientRect()
              const th = card.querySelector('.thumb')?.getBoundingClientRect()
              if (!th) return
              if (zoomTimer.current) clearTimeout(zoomTimer.current)
              const img = card.querySelector('.thumb img') as HTMLImageElement | null
              const aspect = img && img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : th.width / th.height
              let width = Math.min(th.width * 3, window.innerWidth - 16)
              let height = width / aspect
              if (height > window.innerHeight - 16) {
                height = window.innerHeight - 16
                width = height * aspect
              }
              const originX = r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right'
              const originY = r.top + r.height / 2 < window.innerHeight / 2 ? 'top' : 'bottom'
              const next = {
                left: Math.min(Math.max(8, r.left), window.innerWidth - width - 8),
                top: Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - height - 8)),
                width,
                origin: `${originX} ${originY}`,
                open: false
              }
              setZoom(next)
              // 先以起始态挂载,下一帧再打开,确保缩放过渡真的播放而不是直接落位
              requestAnimationFrame(() => setZoom((z) => (z === next ? { ...z, open: true } : z)))
            }}
            onPointerLeave={() => {
              setZoom((z) => (z ? { ...z, open: false } : z))
              zoomTimer.current = setTimeout(() => setZoom(null), 130)
            }}
          />
        ) : null}
      </div>
      <figcaption>
        {disp.name ? (
          <div className="name-row">
            {renaming && activeId === a.id ? (
              <input
                className="name-input"
                defaultValue={a.name}
                autoComplete="off"
                spellCheck={false}
                // 卡片本体点一下就选中/开灯箱,编辑名字时不能让点击漏上去
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                ref={(el) => {
                  // 进入即全选,直接输入就能替换整个名字
                  if (!el) return
                  el.focus()
                  el.select()
                }}
                onBlur={(e) => renameAsset(a.id, e.target.value.trim() || a.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') renameAsset(a.id, (e.target as HTMLInputElement).value.trim() || a.name)
                  if (e.key === 'Escape') setRenaming(false)
                }}
              />
            ) : (
              <span className="name">{a.name}</span>
            )}
          </div>
        ) : null}
        {/* 说明栏只留名字一行 */}

        <span className="lc lc-type">{isImage ? '图片' : a.format}</span>
        <span className="lc lc-res">{listRes === '矢量' ? '' : listRes}</span>
        <span className="lc lc-size">{formatBytes(a.sizeBytes)}</span>
        <span className="lc lc-dur">{isVideo ? (a.duration ?? '—') : '—'}</span>
        <span className="lc lc-date">{formatRelativeDate(a.importedAt)}</span>
        <span className="lc lc-acts">
          {/* 原来这个「更多」按钮没有 onClick,点下去什么也不会发生;
              列表视图已有右键菜单,这里直接打开同一份菜单。 */}
          <button
            title="更多操作"
            aria-label={`更多操作：${a.name}`}
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
      {zoom
        ? createPortal(
            <img
              className="zoom-preview"
              src={previewSrc}
              alt=""
              draggable={false}
              data-open={zoom.open}
              style={{ left: zoom.left, top: zoom.top, width: zoom.width, transformOrigin: zoom.origin }}
            />,
            document.body
          )
        : null}
    </>
  )
}
