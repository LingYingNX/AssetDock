import { useEffect, useState } from 'react'
import { useUI } from '../store/ui'
import { formatBytes, formatFaces, infoRows } from '../data/query'
import { Icon } from './Icons'
import { Cube3D } from './Cube3D'

/** 视角预设条:5 个 64×38 玻璃小格 */
const PRESETS: { title: string; rot: string }[] = [
  { title: '透视', rot: 'rotateX(-24deg) rotateY(24deg)' },
  { title: '前视', rot: 'rotateX(-14deg) rotateY(0deg)' },
  { title: '侧视', rot: 'rotateX(-14deg) rotateY(90deg)' },
  { title: '顶视', rot: 'rotateX(62deg) rotateY(0deg)' },
  { title: '背视', rot: 'rotateX(-14deg) rotateY(180deg)' }
]

const VIEW_ROT: Record<string, string> = {
  front: 'rotateX(-24deg) rotateY(0deg)',
  side: 'rotateX(-24deg) rotateY(90deg)',
  top: 'rotateX(66deg) rotateY(0deg)'
}

export function Lightbox(): React.JSX.Element | null {
  const lightboxId = useUI((s) => s.lightboxId)
  const closeLightbox = useUI((s) => s.closeLightbox)
  const stepLightbox = useUI((s) => s.stepLightbox)
  const assets = useUI((s) => s.assets)
  const toggleFavorite = useUI((s) => s.toggleFavorite)
  const setRating = useUI((s) => s.setRating)
  const [shown, setShown] = useState(false)
  const [paused, setPaused] = useState(false)
  const [wire, setWire] = useState(false)
  const [rot, setRot] = useState<string | null>(null)
  const [preset, setPreset] = useState(0)

  /* 淡入过渡:挂载后下一帧加 .show */
  useEffect(() => {
    if (lightboxId) {
      const id = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
  }, [lightboxId])

  if (!lightboxId) return null
  const a = assets.find((x) => x.id === lightboxId)
  if (!a) return null

  const visible = assets.filter((x) => !x.deletedAt)
  const idx = visible.findIndex((x) => x.id === a.id)
  const isModel = a.type === 'model'

  const sub =
    a.type === 'model'
      ? `${String(idx + 1).padStart(2, '0')} / ${visible.length} · ${formatFaces(a.faceCount ?? 0)} 面 · ${formatBytes(a.sizeBytes)} · ${a.format} · 转台预览`
      : `${String(idx + 1).padStart(2, '0')} / ${visible.length} · ${a.width}×${a.height} · ${formatBytes(a.sizeBytes)} · ${a.format}`

  return (
    <div
      className={`pv${shown ? ' show' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="详情预览"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('pv-stage')) closeLightbox()
      }}
    >
      <div className="pv-top">
        <button className="tb-btn" title="上一个 (←)" onClick={() => stepLightbox(-1)}>
          <Icon name="arr-l" />
        </button>
        <button className="tb-btn" title="下一个 (→)" onClick={() => stepLightbox(1)}>
          <Icon name="arr-r" />
        </button>
        <div className="pv-title">
          <span className="name-b">{a.name}</span>
          <span className="sub">{sub}</span>
        </div>
        <button className="tb-btn" title="收藏" onClick={() => toggleFavorite(a.id)}>
          <Icon name="heart" />
        </button>
        <button className="tb-btn" title="信息面板 (I)"><Icon name="info" /></button>
        <button className="tb-btn" title="导出"><Icon name="download" /></button>
        <button className="tb-btn" title="更多"><Icon name="more-h" /></button>
        <span className="tb-sep" />
        <button className="tb-btn" title="关闭 (Esc)" onClick={closeLightbox}>
          <Icon name="x" />
        </button>
      </div>

      <div className="pv-body">
        <div className="pv-stage">
          <div className="pv-frame">
            {isModel ? (
              <div className={`pv3d${wire ? ' wf' : ''}${paused ? ' paused' : ''}`}>
                <span className="v3-badge"><Icon name="cube" />{a.format} · 转台预览</span>
                <div className="c3d-wrap">
                  <Cube3D cs="186px" transform={rot ?? undefined} />
                </div>
                <div className="v3-bar">
                  <button
                    className={`v3-chip${!paused && !rot ? ' on' : ''}`}
                    title="转台 开/暂停"
                    onClick={() => {
                      const next = !paused
                      setPaused(next)
                      if (!next) { setRot(null); setPreset(0) }
                    }}
                  >
                    <Icon name="rotate-3d" />转台
                  </button>
                  <button
                    className={`v3-chip${wire ? ' on' : ''}`}
                    onClick={() => setWire(!wire)}
                  >
                    线框
                  </button>
                  <span className="vr" />
                  {Object.entries(VIEW_ROT).map(([k, r]) => (
                    <button
                      key={k}
                      className={`v3-chip${rot === r ? ' on' : ''}`}
                      onClick={() => { setRot(r); setPaused(false) }}
                    >
                      {{ front: '前视', side: '侧视', top: '顶视' }[k]}
                    </button>
                  ))}
                  <span className="vr" />
                  <span className="v3-env">环境 · 影棚</span>
                </div>
              </div>
            ) : a.type === 'image' ? (
              <img src={`/@fs/${a.previewUrl}`} alt={a.name} />
            ) : (
              <video src={`/@fs/${a.previewUrl}`} controls autoPlay />
            )}
          </div>
          {isModel && (
            <div className="pv-strip" title="视角预设">
              {PRESETS.map((p, i) => (
                <div
                  key={p.title}
                  className={`fr${rot === p.rot || (!rot && i === 0 && !paused) ? ' cur' : ''}`}
                  title={p.title}
                  onClick={() => { setRot(p.rot); setPaused(false) }}
                >
                  <div className="c3d-wrap"><Cube3D cs="20px" transform={p.rot} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="pv-side">
          <div className="insp-sec">
            <div className="insp-h"><Icon name="info" />{isModel ? '模型信息' : '文件信息'}</div>
            <dl className="dl">
              {infoRows(a).map(([k, v, s]) => (
                <Row key={k} k={k} v={v} sub={s} />
              ))}
            </dl>
          </div>
          <div className="insp-sec">
            <div className="insp-h"><Icon name="star" />评分</div>
            <span className="rate big">
              {[1, 2, 3, 4, 5].map((v) => (
                <span
                  key={v}
                  className={`star${a.rating >= v ? ' fill' : ''}`}
                  onClick={() => setRating(a.id, a.rating === v ? v - 1 : v)}
                >
                  <svg><use href="#i-star" /></svg>
                </span>
              ))}
            </span>
          </div>
          <div className="insp-sec">
            <div className="insp-h"><Icon name="tag" />标签</div>
            <div className="tags">
              {a.tags.map((t) => (
                <span key={t.name} className="tag">
                  <span className="dot" style={{ background: t.color }} />
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Row({ k, v, sub }: { k: string; v: string; sub?: string }): React.JSX.Element {
  return (
    <>
      <dt>{k}</dt>
      <dd>
        {v}
        {sub ? <small>{sub}</small> : null}
      </dd>
    </>
  )
}
