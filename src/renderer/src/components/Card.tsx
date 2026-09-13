import { useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { formatBytes, formatRelativeDate, formatResolution } from '../data/query'
import type { Asset } from '../data/types'
import { MEDIA_ASSETS_DRAG_TYPE, encodeAssetDrag } from '../data/asset-drag'
import { Icon } from './Icons'
import { Cube3D } from './Cube3D'
import { Viewer3D } from './Viewer3D'

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
  const selected = useUI((s) => s.selectedIds.includes(a.id))
  const clickCard = useUI((s) => s.clickCard)
  const openLightbox = useUI((s) => s.openLightbox)
  const setFocusedCard = useUI((s) => s.setFocusedCard)
  const setCtxMenu = useUI((s) => s.setCtxMenu)
  const toggleFavorite = useUI((s) => s.toggleFavorite)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [modelFailed, setModelFailed] = useState(false)
  const dragPreviewRef = useRef<HTMLDivElement | null>(null)

  const cls = [
    'card',
    a.type === 'video' ? 'video' : '',
    a.type === 'model' ? 'c3d' : '',
    selected ? 'is-selected' : '',
    `glass-card`
  ]
    .filter(Boolean)
    .join(' ')

  const ar =
    view === 'grid' || a.type === 'model'
      ? undefined
      : a.width && a.height
        ? `${a.width}/${a.height}`
        : undefined

  const meta =
    a.type === 'model'
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
        clickCard(a.id, { shift: e.shiftKey, order: selectionOrder })
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('.qa')) return
        openLightbox(a.id)
      }}
      onFocus={() => setFocusedCard(a.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        setCtxMenu({ x: e.clientX, y: e.clientY, assetId: a.id })
      }}
    >
      <div
        className={`thumb${a.thumbClass ? ` ${a.thumbClass}` : ''}`}
        style={ar ? ({ ['--ar' as string]: ar } as React.CSSProperties) : undefined}
        role="img"
        aria-label={`${a.type === 'model' ? '三维模型' : a.type === 'video' ? '视频' : '图片'}缩略图:${a.name}`}
      >
        {a.type === 'model' && a.dbId == null ? (
          <div className="c3d-wrap">
            <Cube3D cs="58px" />
          </div>
        ) : a.type === 'model' && a.originalUrl && !modelFailed ? (
          <div className="model-card-preview">
            <Viewer3D
              url={a.originalUrl}
              format={a.format as 'GLB' | 'FBX' | 'OBJ'}
              turntable
              wireframe={false}
              view="auto"
              onError={() => setModelFailed(true)}
            />
          </div>
        ) : a.dbId != null && a.type === 'image' ? (
          <img
            src={a.previewUrl}
            alt={a.name}
            className={imgLoaded ? 'loaded' : ''}
            onLoad={() => setImgLoaded(true)}
            draggable={false}
          />
        ) : a.dbId != null && isVideo ? (
          <video
            src={a.previewUrl}
            muted
            preload="auto"
            className={imgLoaded ? 'loaded' : ''}
            onLoadedData={() => setImgLoaded(true)}
          />
        ) : a.previewUrl && a.type === 'image' ? (
          <img
            src={`/@fs/${a.previewUrl}`}
            alt={a.name}
            className={imgLoaded ? 'loaded' : ''}
            onLoad={() => setImgLoaded(true)}
            draggable={false}
          />
        ) : a.previewUrl && isVideo ? (
          <video
            src={`/@fs/${a.previewUrl}`}
            muted
            preload="auto"
            className={imgLoaded ? 'loaded' : ''}
            onLoadedMetadata={() => setImgLoaded(true)}
          />
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
            <div className="scrub"><i /></div>
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
        <span className="lc lc-res">{a.type === 'model' ? '三维' : formatResolution(a)}</span>
        <span className="lc lc-size">{formatBytes(a.sizeBytes)}</span>
        <span className="lc lc-dur">{isVideo ? (a.duration ?? '—') : '—'}</span>
        <span className="lc lc-date">{formatRelativeDate(a.importedAt)}</span>
        <span className="lc lc-acts">
          <button title="更多"><Icon name="more-h" /></button>
        </span>
      </figcaption>
    </figure>
  )
}
