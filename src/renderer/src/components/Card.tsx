import { useState } from 'react'
import { useUI } from '../store/ui'
import { formatBytes, formatRelativeDate, formatResolution, formatFaces } from '../data/query'
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

  return (
    <figure
      className={cls}
      tabIndex={0}
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

        <button className="cbx" title={selected ? '取消选中' : '选中'} tabIndex={-1}>
          <Icon name="check" />
        </button>
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
          <button title="快速预览" onClick={(e) => { e.stopPropagation(); openLightbox(a.id) }}>
            <Icon name="eye" />
          </button>
          <button title="更多" onClick={(e) => e.stopPropagation()}>
            <Icon name="more-v" />
          </button>
        </div>
        {isVideo && (
          <>
            <span className="play-big"><Icon name="play" /></span>
            <div className="scrub"><i /></div>
          </>
        )}
        {a.type === 'model' && (
          <span className="orb" title="转台预览"><Icon name="rotate-3d" /></span>
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
          <span className="sep2">·</span>
          <span>{meta[1]}</span>
        </div>
        <span className="lc lc-type">{a.format}</span>
        <span className="lc lc-res">{a.type === 'model' ? (a.faceCount == null ? '— 面' : `${formatFaces(a.faceCount)} 面`) : formatResolution(a)}</span>
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
