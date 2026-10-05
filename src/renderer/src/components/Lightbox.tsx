import { useEffect, useState } from 'react'
import { useUI } from '../store/ui'
import { formatBytes } from '../data/query'
import { Icon } from './Icons'
import { Cube3D } from './Cube3D'
import { Viewer3D, type ViewKey } from './Viewer3D'
import { CssEditor } from './CssEditor'
import { VideoControls, useVideoPlayback } from './VideoControls'
import { Filmstrip } from './Filmstrip'

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

export function Lightbox(): React.JSX.Element | null {
  const lightboxId = useUI((s) => s.lightboxId)
  const closeLightbox = useUI((s) => s.closeLightbox)
  const stepLightbox = useUI((s) => s.stepLightbox)
  const assets = useUI((s) => s.assets)
  const toggleFavorite = useUI((s) => s.toggleFavorite)
  const fullscreen = useUI((s) => s.lightboxFullscreen)
  const setFullscreen = useUI((s) => s.setLightboxFullscreen)
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

  /* 当前素材:早退之前不能调 hook,故先算出安全值再交给 useVideoPlayback */
  const a = assets.find((x) => x.id === lightboxId)
  const isVideo = a?.type === 'video'
  const videoSrc = isVideo && a ? (a.dbId != null ? (a.originalUrl ?? '') : `/@fs/${a.previewUrl ?? ''}`) : ''
  const playback = useVideoPlayback(videoSrc)

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

  /**
   * 空格播放/暂停、F 全屏。
   *
   * 放在组件内而非 App 的全局快捷键表里,因为两者都要摸到当前媒体对象(播放态、video 节点)。
   * 输入框内不劫持;其余情况 preventDefault 掉原生按钮激活,避免按一次触发两遍。
   */
  useEffect(() => {
    if (!lightboxId) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (e.code === 'Space') {
        if (!isVideo) return
        e.preventDefault()
        playback.toggle()
        return
      }
      if (k === 'f') {
        e.preventDefault()
        setFullscreen(!useUI.getState().lightboxFullscreen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxId, isVideo, playback, setFullscreen])

  if (!lightboxId) return null
  if (!a) return null

  const visible = assets.filter((x) => !x.deletedAt)
  const idx = visible.findIndex((x) => x.id === a.id)
  const isModel = a.type === 'model'
  const isStyle = a.type === 'style'
  const realModel = isModel && a.dbId != null && ['GLB', 'FBX', 'OBJ'].includes(a.format) && !!a.originalUrl

  const sub =
    a.type === 'model'
      ? `${String(idx + 1).padStart(2, '0')} / ${visible.length} · ${formatBytes(a.sizeBytes)} · ${a.format} · 转台预览`
      : a.type === 'style'
        ? `${String(idx + 1).padStart(2, '0')} / ${visible.length} · ${formatBytes(a.sizeBytes)} · ${a.format}`
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
      className={`pv${shown ? ' show' : ''}${fullscreen ? ' full' : ''}`}
      role="dialog"
      aria-modal={fullscreen}
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
        <button className="tb-btn" title="导出"><Icon name="download" /></button>
        <button className="tb-btn" title="更多"><Icon name="more-h" /></button>
        <span className="tb-sep" />
        <button className="tb-btn" title="关闭 (Esc)" onClick={closeLightbox}>
          <Icon name="x" />
        </button>
      </div>

      <div className={`pv-body${isStyle ? ' style-body' : ''}`}>
        {isStyle ? (
          <CssEditor a={a} />
        ) : (
        <>
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
                  format={a.format as 'GLB' | 'FBX' | 'OBJ'}
                  turntable={realTurn}
                  wireframe={realWire}
                  view={realView}
                  exposure={exposure}
                  onProgress={setLoadPct}
                />
                {loadPct != null && loadPct < 100 && (
                  <div className="pv-loading">
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
                      style={{ background: `linear-gradient(90deg,var(--acc) ${((exposure - 0.4) / 1.2) * 100}%,var(--line2) ${((exposure - 0.4) / 1.2) * 100}%)` }}
                      onChange={(e) => changeExposure(Number(e.target.value))}
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
                <video ref={playback.ref} src={a.originalUrl ?? ''} {...playback.handlers} />
              )
            ) : a.type === 'image' ? (
              <img src={`/@fs/${a.previewUrl}`} alt={a.name} />
            ) : (
              <video ref={playback.ref} src={`/@fs/${a.previewUrl}`} {...playback.handlers} />
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
        </>
        )}
      </div>

      {/* 控制条:全屏对任何素材都有效;其余按钮只在视频上出现 */}
      {!isStyle ? (
        <div className="pv-ctlbar">
          {isVideo ? (
            <VideoControls v={playback} fullscreen={fullscreen} onFullscreen={() => setFullscreen(!fullscreen)} />
          ) : (
            <div className="pv-ctl">
              <span className="sp" />
              <button
                className="tb-btn"
                title={fullscreen ? '退出全屏 (F)' : '全屏 (F)'}
                onClick={() => setFullscreen(!fullscreen)}
              >
                <Icon name={fullscreen ? 'contract' : 'expand'} />
              </button>
            </div>
          )}
        </div>
      ) : null}

      <Filmstrip />
    </div>
  )
}
