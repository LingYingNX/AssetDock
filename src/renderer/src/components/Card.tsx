import { useState } from 'react'
import { useUI } from '../store/ui'
import { formatBytes, formatRelativeDate, formatResolution } from '../data/query'
import type { Asset } from '../data/types'
import { Icon } from './Icons'
import { Cube3D } from './Cube3D'

/** 视频/三维格式徽章圆点颜色(规格第 10 节) */
const FORMAT_DOT: Partial<Record<Asset['format'], string>> = {
  MP4: '#3B82F6',
  MOV: '#F97316',
  PSD: '#8B5CF6',
  GLB: '#22D3EE',
  FBX: '#22D3EE',
  OBJ: '#22D3EE'
}

export function Card({ a, view }: { a: Asset; view: string }): React.JSX.Element {
  const selected = useUI((s) => s.selectedIds.includes(a.id))
  const clickCard = useUI((s) => s.clickCard)
  const openLightbox = useUI((s) => s.openLightbox)
  const setFocusedCard = useUI((s) => s.setFocusedCard)
  const setCtxMenu = useUI((s) => s.setCtxMenu)
  const toggleFavorite = useUI((s) => s.toggleFavorite)
  const nonce = useUI((s) => s.thumbNonce)
  const [imgLoaded, setImgLoaded] = useState(false)

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
  const canMove = a.dbId != null && a.libraryId != null && !a.sourceIndexId && !a.missing && !a.deletedAt

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
          ? state.selectedIds.filter((id) => state.assets.some((asset) => asset.id === id && asset.dbId != null && !asset.sourceIndexId && !asset.missing && !asset.deletedAt))
          : [a.id]
        e.dataTransfer.setData('application/x-mediahub-assets', JSON.stringify(ids))
        e.dataTransfer.effectAllowed = 'move'
      }}
      aria-label={`${a.name}.${a.format.toLowerCase()}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.qa')) return
        clickCard(a.id)
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
        ) : a.dbId != null ? (
          <img
            src={`${a.previewUrl}?v=${nonce}`}
            alt={a.name}
            className={imgLoaded ? 'loaded' : ''}
            onLoad={() => setImgLoaded(true)}
            draggable={false}
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
            preload="metadata"
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
