import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUI } from '../store/ui'
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
        transition: 'transform 120ms cubic-bezier(.23,1,.32,1)',
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
  const assets = useUI((s) => s.assets)
  const fullscreen = useUI((s) => s.lightboxFullscreen)
  const setFullscreen = useUI((s) => s.setLightboxFullscreen)
  const [shown, setShown] = useState(false)
  /* 关闭时 lightboxId 立刻变 null,但画面还要停留一拍播完淡出,所以:
     mounted 决定「在不在」,lastId 决定「退场期间画哪一张」。
     原来 `if (!lightboxId) return null` 是 0ms 硬闪——半透明背景直接消失,
     用户看到的是「点了关闭,窗口闪一下」。 */
  const [mounted, setMounted] = useState(lightboxId != null)
  const [lastId, setLastId] = useState(lightboxId)
  /* 退场期间要停在离场时的那个形态:.full 是 position:absolute→fixed 的整值跳变,
     关闭时若让 fullscreen 直接归假,元素会一边淡出一边从整窗缩回工作区,像被拽了一下。
     留住最后一次的全屏状态,让它原地淡出。 */
  const [lastFull, setLastFull] = useState(false)
  /* 全屏切换是 position:absolute→fixed 的整值跳变,position 不可过渡。
     做法是先留住旧矩形的快照,等切换落地后再做一次反向补偿 —— 这就是 FLIP。 */
  const rootRef = useRef<HTMLDivElement>(null)
  const fsFlip = useRef<{ first: DOMRect; animated: boolean } | null>(null)
  /* reduced-motion 下不做 FLIP 补偿:用户明确要求少动,这里就不该替它补一段 */
  const reduceMotion = useRef(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

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

  /* 当前素材:早退之前不能调 hook,故先算出安全值再交给 useVideoPlayback。
     退场期间用 lastId,保证画面在被淡出的那一拍里还是原来那张 */
  const a = assets.find((x) => x.id === (lightboxId ?? lastId))
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

  /* 入场与退场。打开:先挂载、下一帧置 shown 播淡入。
     关闭:先置 shown=false 播淡出,180ms 后再卸载——不能只等 transitionend,
     reduced-motion 下过渡被全局移除,事件永不触发,灯箱会永远留在屏幕上。
     换片(lightboxId 从 A 变 B)不该重播退场,所以只在「变 null」时才进入退场分支。 */
  useEffect(() => {
    if (lightboxId) {
      setLastId(lightboxId)
      setMounted(true)
      return
    }
    setShown(false)
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 220)
    return () => window.clearTimeout(t)
  }, [lightboxId, mounted])

  useEffect(() => {
    if (!mounted || !lightboxId) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [mounted, lightboxId])

  /* 记录退场时要保持的全屏形态 */
  useEffect(() => {
    if (lightboxId) setLastFull(useUI.getState().lightboxFullscreen)
  }, [lightboxId, fullscreen])

  useEffect(() => {
    setPaused(false)
    setWire(false)
    setRot(null)
    setRealWire(false)
    setRealView('auto')
    setLoadPct(undefined)
    setRealTurn(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [lightboxId])

  /* 全屏 FLIP。position 不可过渡,所以整值切换必须靠反向补偿补出连续感:
     切换前(点击那一刻)先存旧矩形,布局落地后量新矩形,把元素按差值平移缩放回旧位置,
     下一帧再清掉内联样式,让 CSS 里已有的 transform 过渡把它送回真实位置。
     useLayoutEffect 在浏览器绘制前执行,读到的 rect 就是新布局,不会先闪一帧。 */
  useLayoutEffect(() => {
    const el = rootRef.current
    const pending = fsFlip.current
    if (!el || !pending || !pending.animated) return
    fsFlip.current = null
    const last = el.getBoundingClientRect()
    if (last.width <= 0 || last.height <= 0) return
    const dx = pending.first.left - last.left
    const dy = pending.first.top - last.top
    const sx = pending.first.width / last.width
    const sy = pending.first.height / last.height
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return
    el.style.transition = 'none'
    el.style.transformOrigin = 'top left'
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
    window.requestAnimationFrame(() => {
      el.style.transition = ''
      el.style.transformOrigin = ''
      el.style.transform = ''
    })
  }, [fullscreen])

  /**
   * 空格播放/暂停、F 全屏。
   *
   * 放在组件内而非 App 的全局快捷键表里,因为两者都要摸到当前媒体对象(播放态、video 节点)。
   * 输入框内不劫持;其余情况 preventDefault 掉原生按钮激活,避免按一次触发两遍。
   */
  /* 切换全屏:先量当前矩形存进快照,由上面的 useLayoutEffect 在切换落地后做 FLIP 补偿。
     所有入口(按钮、快捷键 F、视频控制条)都走这里,否则某一条路径会漏掉动画。 */
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    // reduced-motion 下 mark 为 false,useLayoutEffect 直接跳过补偿
    if (el) fsFlip.current = { first: el.getBoundingClientRect(), animated: !reduceMotion.current }
    setFullscreen(!useUI.getState().lightboxFullscreen)
  }, [setFullscreen])

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
        toggleFullscreen()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxId, isVideo, playback, toggleFullscreen])

  /* 退场期间 lightboxId 已为 null,靠 mounted 撑着最后 220ms 的淡出 */
  if (!mounted) return null
  if (!a) return null
  /* 真实显示态:退场时锁住离开那一刻的全屏形态 */
  const fsNow = lightboxId ? fullscreen : lastFull

  const isModel = a.type === 'model'
  const isStyle = a.type === 'style'
  const realModel = isModel && a.dbId != null && ['GLB', 'FBX', 'OBJ'].includes(a.format) && !!a.originalUrl

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
      ref={rootRef}
      className={`pv${shown ? ' show' : ''}${fsNow ? ' full' : ''}`}
      role="dialog"
      aria-modal={fsNow}
      aria-label="详情预览"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('pv-stage')) closeLightbox()
      }}
    >
      {/* 极简顶栏:只留关闭。翻片走胶片带,收藏/评分/导出交给右侧检查器与右键菜单 */}
      <div className="pv-top">
        <span className="sp" />
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
            <VideoControls v={playback} fullscreen={fsNow} onFullscreen={toggleFullscreen} />
          ) : (
            <div className="pv-ctl">
              <span className="sp" />
              <button
                className="tb-btn"
                title={fsNow ? '退出全屏 (F)' : '全屏 (F)'}
                onClick={toggleFullscreen}
              >
                <Icon name={fsNow ? 'contract' : 'expand'} />
              </button>
            </div>
          )}
        </div>
      ) : null}

      <Filmstrip />
    </div>
  )
}
