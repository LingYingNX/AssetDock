import { useEffect, useState } from 'react'
import { useUI } from '../store/ui'
import { formatBytes, infoRows } from '../data/query'
import { Icon } from './Icons'
import { Cube3D } from './Cube3D'
import { Viewer3D, type ViewKey } from './Viewer3D'

/** 舞台媒体加载失败占位 */
function MediaFallback(): React.JSX.Element {
  return (
    <div className="empty" style={{ minHeight: 240 }}>
      <Icon name="image" />
      <span>文件加载失败或已缺失</span>
    </div>
  )
}

/** 图片查看:滚轮缩放(以光标为锚),双击重置 */
function MediaImg({ src, name }: { src: string; name: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const [scale, setScale] = useState(1)
  const [origin, setOrigin] = useState('50% 50%')
  useEffect(() => {
    setFailed(false)
    setScale(1)
    setOrigin('50% 50%')
  }, [src])
  if (failed) return <MediaFallback />
  return (
    <img
      src={src}
      alt={name}
      draggable={false}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: origin,
        transition: 'transform .12s ease-out',
        cursor: scale > 1 ? 'grab' : 'zoom-in'
      }}
      onWheel={(e) => {
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * 100
        const y = ((e.clientY - rect.top) / rect.height) * 100
        setOrigin(`${Math.min(100, Math.max(0, x))}% ${Math.min(100, Math.max(0, y))}%`)
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
        setScale((s) => Math.min(10, Math.max(0.2, s * factor)))
      }}
      onDoubleClick={() => {
        setScale(1)
        setOrigin('50% 50%')
      }}
      onError={() => setFailed(true)}
    />
  )
}

function MediaVideo({ src }: { src: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (failed) return <MediaFallback />
  return <video src={src} controls autoPlay onError={() => setFailed(true)} />
}

/** 视角预设条:5 个 64×38 玻璃小格 */
const PRESETS: { title: string; rot: string; view: ViewKey }[] = [
  { title: '透视', rot: 'rotateX(-24deg) rotateY(24deg)', view: 'auto' },
  { title: '前视', rot: 'rotateX(-14deg) rotateY(0deg)', view: 'front' },
  { title: '侧视', rot: 'rotateX(-14deg) rotateY(90deg)', view: 'side' },
  { title: '顶视', rot: 'rotateX(62deg) rotateY(0deg)', view: 'top' },
  { title: '背视', rot: 'rotateX(-14deg) rotateY(180deg)', view: 'back' }
]

const VIEW_ROT: Record<string, string> = {
  front: 'rotateX(-24deg) rotateY(0deg)',
  side: 'rotateX(-24deg) rotateY(90deg)',
  top: 'rotateX(66deg) rotateY(0deg)'
}

const VIEW_LABEL: Record<ViewKey, string> = {
  auto: '透视',
  front: '前视',
  side: '侧视',
  top: '顶视',
  back: '背视'
}

export function Lightbox(): React.JSX.Element | null {
  const lightboxId = useUI((s) => s.lightboxId)
  const closeLightbox = useUI((s) => s.closeLightbox)
  const stepLightbox = useUI((s) => s.stepLightbox)
  const assets = useUI((s) => s.assets)
  const toggleFavorite = useUI((s) => s.toggleFavorite)
  const setRating = useUI((s) => s.setRating)
  const [shown, setShown] = useState(false)

  /* 占位舞台(FBX/OBJ/演示模型)状态 */
  const [paused, setPaused] = useState(false)
  const [wire, setWire] = useState(false)
  const [rot, setRot] = useState<string | null>(null)

  /* 真实 3D(GLB/glTF)状态:reduced-motion 默认暂停转台 */
  const [realTurn, setRealTurn] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const [realWire, setRealWire] = useState(false)
  const [realView, setRealView] = useState<ViewKey>('auto')
  const [exposure, setExposure] = useState(1)
  const [loadPct, setLoadPct] = useState<number | null | undefined>(undefined)

  /* 曝光持久化:打开灯箱时读应用状态(组件常驻挂载,不可依赖[]) */
  useEffect(() => {
    void window.windowApi.state.get('viewerExposure').then((v) => {
      const n = Number(v)
      if (v != null && !Number.isNaN(n)) setExposure(Math.min(1.6, Math.max(0.4, n)))
    })
  }, [lightboxId])

  const changeExposure = (v: number): void => {
    setExposure(v)
    void window.windowApi.state.set('viewerExposure', String(v))
  }

  /* 淡入过渡 + 素材切换时重置控制状态 */
  useEffect(() => {
    if (lightboxId) {
      const id = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
  }, [lightboxId])

  useEffect(() => {
    setPaused(false)
    setWire(false)
    setRot(null)
    setRealWire(false)
    setRealView('auto')
    setLoadPct(undefined)
    setRealTurn(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [lightboxId])

  if (!lightboxId) return null
  const a = assets.find((x) => x.id === lightboxId)
  if (!a) return null

  const visible = assets.filter((x) => !x.deletedAt)
  const idx = visible.findIndex((x) => x.id === a.id)
  const isModel = a.type === 'model'
  const realModel = isModel && a.dbId != null && a.format === 'GLB' && !!a.originalUrl

  const sub =
    a.type === 'model'
      ? `${String(idx + 1).padStart(2, '0')} / ${visible.length} · ${formatBytes(a.sizeBytes)} · ${a.format} · 转台预览`
      : `${String(idx + 1).padStart(2, '0')} / ${visible.length} · ${a.width}×${a.height} · ${formatBytes(a.sizeBytes)} · ${a.format}`

  /* 控制条动作(按真实/占位分流) */
  const onTurntable = (): void => {
    if (realModel) {
      setRealTurn((t) => !t)
      if (!realTurn) setRealView('auto')
    } else {
      const next = !paused
      setPaused(next)
      if (!next) {
        setRot(null)
        setRealView('auto')
      }
    }
  }
  const onWireframe = (): void => (realModel ? setRealWire(!realWire) : setWire(!wire))
  const onViewChip = (v: Exclude<ViewKey, 'auto' | 'back'>): void => {
    if (realModel) {
      setRealView(v)
      setRealTurn(false)
    } else {
      setRot(VIEW_ROT[v])
      setPaused(false)
    }
  }
  const onPreset = (p: (typeof PRESETS)[number]): void => {
    if (realModel) {
      if (p.view === 'auto') {
        setRealView('auto')
        setRealTurn(true)
      } else {
        setRealView(p.view)
        setRealTurn(false)
      }
    } else {
      setRot(p.rot)
      setPaused(false)
    }
  }

  const stageClass = realModel ? '' : `pv3d${wire ? ' wf' : ''}${paused ? ' paused' : ''}`
  const curPresetIndex = realModel
    ? PRESETS.findIndex((p) => p.view === realView)
    : rot
      ? PRESETS.findIndex((p) => p.rot === rot)
      : !paused
        ? 0
        : -1

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
        <button className="tb-btn" title="后退 (Esc)" onClick={closeLightbox}>
          <Icon name="chev-l" />
        </button>
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
          <div
            className="pv-frame"
            onClick={(e) => {
              if (isModel) return
              const t = e.target as HTMLElement
              if (t.tagName === 'IMG' || t.tagName === 'VIDEO' || t.tagName === 'CANVAS' || t.closest('button') || t.closest('input')) return
              closeLightbox()
            }}
          >
            {realModel ? (
              <div className="pv3d" style={{ position: 'relative' }}>
                <span className="v3-badge"><Icon name="cube" />{a.format} · 转台预览</span>
                <Viewer3D
                  url={a.originalUrl ?? ''}
                  turntable={realTurn}
                  wireframe={realWire}
                  view={realView}
                  exposure={exposure}
                  onProgress={setLoadPct}
                />
                {loadPct != null && loadPct < 100 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%,-50%)',
                      zIndex: 3,
                      padding: '6px 14px',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,.72)',
                      border: '1px solid rgba(255,255,255,.95)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#0A4E9E',
                      boxShadow: '0 6px 18px rgba(20,60,120,.18)'
                    }}
                  >
                    {loadPct === null ? '解析模型…' : `加载中 ${Math.round(loadPct)}%`}
                  </div>
                )}
                <div className="v3-bar">
                  <button className={`v3-chip${realTurn && realView === 'auto' ? ' on' : ''}`} title="转台 开/暂停" onClick={onTurntable}>
                    <Icon name="rotate-3d" />转台
                  </button>
                  <button className={`v3-chip${realWire ? ' on' : ''}`} onClick={onWireframe}>
                    线框
                  </button>
                  <span className="vr" />
                  <button className={`v3-chip${realView === 'front' ? ' on' : ''}`} onClick={() => onViewChip('front')}>前视</button>
                  <button className={`v3-chip${realView === 'side' ? ' on' : ''}`} onClick={() => onViewChip('side')}>侧视</button>
                  <button className={`v3-chip${realView === 'top' ? ' on' : ''}`} onClick={() => onViewChip('top')}>顶视</button>
                  <span className="vr" />
                  <span className="v3-env">环境 · 影棚</span>
                  <span className="vr" />
                  <span className="zoomer" style={{ gap: 5 }} title="曝光 0.4–1.6">
                    <Icon name="spark" />
                    <input
                      type="range"
                      min={0.4}
                      max={1.6}
                      step={0.05}
                      value={exposure}
                      aria-label="影棚曝光"
                      ref={(el) => {
                        if (el) {
                          const p = ((Number(el.value) - 0.4) / 1.2) * 100
                          el.style.background = `linear-gradient(90deg,var(--acc) ${p}%,rgba(255,255,255,.55) ${p}%)`
                        }
                      }}
                      onChange={(e) => {
                        changeExposure(Number(e.target.value))
                        const p = ((Number(e.target.value) - 0.4) / 1.2) * 100
                        e.target.style.background = `linear-gradient(90deg,var(--acc) ${p}%,rgba(255,255,255,.55) ${p}%)`
                      }}
                    />
                  </span>
                </div>
              </div>
            ) : isModel ? (
              <div className={stageClass}>
                <span className="v3-badge"><Icon name="cube" />{a.format} · 转台预览</span>
                <div className="c3d-wrap">
                  <Cube3D cs="186px" transform={rot ?? undefined} />
                </div>
                <div className="v3-bar">
                  <button
                    className={`v3-chip${!paused && !rot ? ' on' : ''}`}
                    title="转台 开/暂停"
                    onClick={onTurntable}
                  >
                    <Icon name="rotate-3d" />转台
                  </button>
                  <button className={`v3-chip${wire ? ' on' : ''}`} onClick={onWireframe}>
                    线框
                  </button>
                  <span className="vr" />
                  <button className={`v3-chip${rot === VIEW_ROT.front ? ' on' : ''}`} onClick={() => onViewChip('front')}>前视</button>
                  <button className={`v3-chip${rot === VIEW_ROT.side ? ' on' : ''}`} onClick={() => onViewChip('side')}>侧视</button>
                  <button className={`v3-chip${rot === VIEW_ROT.top ? ' on' : ''}`} onClick={() => onViewChip('top')}>顶视</button>
                  <span className="vr" />
                  <span className="v3-env">环境 · 影棚</span>
                </div>
              </div>
            ) : a.dbId != null ? (
              a.type === 'image' ? (
                <MediaImg src={a.originalUrl ?? ''} name={a.name} />
              ) : (
                <MediaVideo src={a.originalUrl ?? ''} />
              )
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
                  className={`fr${curPresetIndex === i ? ' cur' : ''}`}
                  title={p.title}
                  onClick={() => onPreset(p)}
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
