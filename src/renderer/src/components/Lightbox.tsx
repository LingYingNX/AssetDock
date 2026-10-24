import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { formatResolution } from '../data/query'
import { Icon } from './Icons'
import { Cube3D } from './Cube3D'
import { LazyViewer3D } from './LazyViewer3D'
import { LazyEnvMapViewer } from './LazyEnvMapViewer'
import type { ModelShade, Viewer3DFormat } from './Viewer3D'
import { CssEditor } from './CssEditor'
import { VideoControls, useVideoPlayback, type VideoPlayback } from './VideoControls'
import { Filmstrip } from './Filmstrip'
import { formatSpec, needsVideoTranscode } from '../../../shared/formats'

let videoSessionSeq = 0
let videoLoadSeq = 0

/** 舞台媒体加载失败占位 */
function MediaFallback({ label = '文件加载失败或已缺失' }: { label?: string }): React.JSX.Element {
  return (
    <div className="empty" style={{ minHeight: 240 }}>
      <Icon name="image" />
      <span>{label}</span>
    </div>
  )
}

/** 媒体元素由 effect 原生创建,避免 React 接管 video 时干扰 Chromium 解码管线。 */
function VideoElement({ src, playback }: { src: string; playback: VideoPlayback }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let video: HTMLVideoElement | null = null
    let cancelled = false
    const play = (): void => { void video?.play().catch(() => undefined) }
    const timer = window.setTimeout(() => {
      if (cancelled) return
      video = document.createElement('video')
      video.preload = 'auto'
      video.autoplay = true
      host.appendChild(video)
      playback.ref.current = video
      video.addEventListener('canplay', play)
      video.src = `${src}${src.includes('?') ? '&' : '?'}load=${++videoLoadSeq}`
      play()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (!video) return
      video.removeEventListener('canplay', play)
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
      if (playback.ref.current === video) playback.ref.current = null
    }
  }, [src, playback.ref])

  return <div ref={hostRef} className="pv-video-element" />
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

export function Lightbox(): React.JSX.Element | null {
  const lightboxId = useUI((s) => s.lightboxId)
  const closeLightbox = useUI((s) => s.closeLightbox)
  const assets = useUI((s) => s.assets)
  const showToast = useUI((s) => s.showToast)
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

  const [modelShade, setModelShade] = useState<ModelShade>('solid')
  const [envExposure, setEnvExposure] = useState(1)
  const [loadPct, setLoadPct] = useState<number | null | undefined>(undefined)
  const [realFailed, setRealFailed] = useState(false)
  const [prepareNonce, setPrepareNonce] = useState(0)
  const [videoEpoch] = useState(() => ++videoSessionSeq)
  const [preparedMedia, setPreparedMedia] = useState<{
    id: string
    url?: string
    progress?: number | null
    error?: string
    message?: string
    pages?: number
  } | null>(null)
  const [pdfPage, setPdfPage] = useState(1)

  /* 当前素材:早退之前不能调 hook,故先算出安全值再交给 useVideoPlayback。
     退场期间用 lastId,保证画面在被淡出的那一拍里还是原来那张 */
  const a = assets.find((x) => x.id === (lightboxId ?? lastId))
  const thumbRevision = useUI((s) => a?.fingerprint ? (s.thumbRevisions[a.fingerprint] ?? 0) : 0)
  const isVideo = a?.type === 'video'
  const isModel = a?.type === 'model'
  const isStyle = a?.type === 'style'
  const spec = a ? formatSpec(a.format) : undefined
  const isEnvMap = spec?.preview === 'envmap'
  const transcodeRequired = isVideo && !!a && needsVideoTranscode(a.format)
  const aiRequired = a?.format === 'AI'
  const blendRequired = a?.format === 'BLEND'
  const c4dRequired = a?.format === 'C4D'
  const prepareRequired = transcodeRequired || aiRequired || blendRequired || c4dRequired
  const rawVideoSrc = isVideo && a ? (a.dbId != null ? a.originalUrl ?? '' : `/@fs/${a.previewUrl ?? ''}`) : ''
  const sourceVideo = rawVideoSrc
    ? `${rawVideoSrc}${rawVideoSrc.includes('?') ? '&' : '?'}lightbox=1&session=${videoEpoch}`
    : ''
  const videoSrc = transcodeRequired
    ? (preparedMedia?.id === a?.id ? preparedMedia.url ?? '' : '')
    : sourceVideo
  const playback = useVideoPlayback(videoSrc)

  useEffect(() => {
    if (!a || !prepareRequired || a.libraryId == null || a.dbId == null) {
      setPreparedMedia(null)
      return
    }
    let cancelled = false
    const libraryId = a.libraryId
    const assetId = a.dbId
    setPreparedMedia({ id: a.id, progress: null })
    const off = window.windowApi.on('transcode:progress', (payload) => {
      if (cancelled || payload.libraryId !== libraryId || payload.assetId !== assetId) return
      setPreparedMedia((current) => ({
        id: a.id,
        url: current?.url,
        progress: payload.progress,
        error: payload.error
      }))
    })
    void window.windowApi.assets.preparePreview(libraryId, assetId).then((result) => {
      if (cancelled) return
      if ('error' in result) {
        setPreparedMedia({ id: a.id, error: result.error })
      } else if (result.kind === 'video') {
        setPreparedMedia({ id: a.id, url: result.url, progress: 100 })
      } else if (result.kind === 'three') {
        setPreparedMedia({ id: a.id, url: result.url, progress: 100 })
      } else if (result.kind === 'pdf') {
        setPreparedMedia({ id: a.id, url: result.url, pages: result.pages })
      } else if (result.kind === 'external') {
        setPreparedMedia({ id: a.id, message: result.message })
      } else {
        setPreparedMedia({ id: a.id, url: sourceVideo, progress: 100 })
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setPreparedMedia({ id: a.id, error: error instanceof Error ? error.message : '媒体准备失败' })
      }
    })
    return () => {
      cancelled = true
      off()
    }
  }, [a?.id, a?.libraryId, a?.dbId, prepareRequired, sourceVideo, prepareNonce])

  useEffect(() => {
    setPdfPage(1)
  }, [lightboxId])

  useEffect(() => {
    if (!isEnvMap) return
    let cancelled = false
    void window.windowApi.state.get('viewerExposure').then((value) => {
      if (value == null) return
      const parsed = Number(value)
      if (!cancelled && Number.isFinite(parsed) && parsed >= 0 && parsed <= 10) setEnvExposure(parsed)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [isEnvMap, lightboxId])

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
    setLoadPct(undefined)
    setRealFailed(false)
    setModelShade('solid')
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
      if (isVideo && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const fps = a?.fps && a.fps > 0 ? a.fps : 30
        playback.stepBy((e.key === 'ArrowLeft' ? -1 : 1) / fps)
        return
      }
      if (isVideo && k === 'm') {
        e.preventDefault()
        playback.toggleMute()
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
  }, [lightboxId, isVideo, a?.fps, playback, toggleFullscreen])

  /* 退场期间 lightboxId 已为 null,靠 mounted 撑着最后 220ms 的淡出 */
  if (!mounted) return null
  if (!a) return null
  /* 真实显示态:退场时锁住离开那一刻的全屏形态 */
  const fsNow = lightboxId ? fullscreen : lastFull

  const prepared = preparedMedia?.id === a.id ? preparedMedia : null
  const preparedModelUrl = a.format === 'BLEND' ? prepared?.url : undefined
  const realModel = isModel && a.dbId != null && !!a.originalUrl &&
    (spec?.preview === 'three' || !!preparedModelUrl)
  const viewerUrl = preparedModelUrl ?? a.originalUrl ?? ''
  const viewerFormat = (a.format === 'BLEND' ? 'GLB' : a.format) as Viewer3DFormat
  const externalNotice = prepared?.error ?? prepared?.message
  const retryPreview = (): void => setPrepareNonce((value) => value + 1)
  const openExternally = (): void => {
    if (a.libraryId == null || a.dbId == null) return
    void window.windowApi.assets.openExternal(a.libraryId, a.dbId).then((result) => {
      if ('error' in result) showToast(result.error, 'warn')
    }).catch(() => showToast('无法启动外部软件', 'warn'))
  }
  const directImage = ['JPG', 'PNG', 'WEBP', 'GIF', 'SVG', 'AVIF'].includes(a.format)
  const aiPageUrl = prepared?.url
    ? prepared.url.replace(/([?&])page=\d+/, `$1page=${pdfPage}`)
    : ''
  const imageViewUrl = a.format === 'AI'
    ? aiPageUrl
    : directImage
      ? a.originalUrl ?? ''
      : a.previewUrl ?? ''
  const refreshedImageViewUrl = imageViewUrl
    ? `${imageViewUrl}${imageViewUrl.includes('?') ? '&' : '?'}thumbReady=${thumbRevision}`
    : ''
  const assetMeta = formatResolution(a).replace('×', ' × ') || a.format

  return (
    <div
      ref={rootRef}
      className={`pv${shown ? ' show' : ''}${fsNow ? ' full' : ''}${isModel ? ' model' : ''}`}
      role="dialog"
      aria-modal={fsNow}
      aria-label="详情预览"
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('pv-stage')) closeLightbox()
      }}
    >
      {/* 顶栏只承担进出,中间完全留白,信息统一下沉到播放器底栏。 */}
      <div className="pv-top">
        <button className="pv-corner-btn" title="返回 (Esc)" aria-label="返回" onClick={closeLightbox}>
          <Icon name="arr-l" />
        </button>
      </div>

      <div className={`pv-body${isStyle ? ' style-body' : ''}${isVideo || isModel || isEnvMap ? ' video-body' : ''}`}>
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
              <div className="pv3d">
                <div className="pv-model-meta">
                  <strong title={a.name}>{a.name}</strong>
                  <span>·</span>
                  <span>{assetMeta}</span>
                </div>
                <LazyViewer3D
                  url={viewerUrl}
                  format={viewerFormat}
                  shade={modelShade}
                  onProgress={setLoadPct}
                  onLoaded={() => setRealFailed(false)}
                  onError={() => {
                    setRealFailed(true)
                    setLoadPct(100)
                  }}
                />
                {!realFailed && loadPct != null && loadPct < 100 && (
                  <div className="pv-loading">
                    {loadPct === null ? '解析模型…' : `加载中 ${Math.round(loadPct)}%`}
                  </div>
                )}
                <div className="v3-bar">
                  <button
                    className={`v3-chip${modelShade === 'solid' ? ' on' : ''}`}
                    onClick={() => setModelShade('solid')}
                  >
                    实体模式
                  </button>
                  <button
                    className={`v3-chip${modelShade === 'render' ? ' on' : ''}`}
                    onClick={() => setModelShade('render')}
                  >
                    渲染模型
                  </button>
                </div>
              </div>
            ) : isModel ? (
              <div className="pv3d">
                <div className="pv-model-meta">
                  <strong title={a.name}>{a.name}</strong>
                  <span>·</span>
                  <span>{assetMeta}</span>
                </div>
                <div className="c3d-wrap">
                  <Cube3D cs="186px" />
                </div>
                {spec?.preview === 'external' && (
                  <div className="pv-loading">
                    {externalNotice ?? (a.format === 'BLEND' ? '正在用 Blender 准备预览…' : '正在检查外部软件…')}
                  </div>
                )}
                {spec?.preview === 'external' && (
                  <div className="v3-bar">
                    <button
                      className="v3-chip"
                      onClick={() => {
                        if (a.libraryId == null || a.dbId == null) return
                        void window.windowApi.assets.openExternal(a.libraryId, a.dbId).then((result) => {
                          if ('error' in result) showToast(result.error, 'warn')
                        }).catch(() => showToast('无法启动外部软件', 'warn'))
                      }}
                    >
                      用外部软件打开
                    </button>
                  </div>
                )}
              </div>
            ) : isEnvMap ? (
              <div className="pv3d">
                <div className="pv-model-meta">
                  <strong title={a.name}>{a.name}</strong>
                  <span>·</span>
                  <span>{assetMeta}</span>
                </div>
                <LazyEnvMapViewer
                  url={a.originalUrl ?? ''}
                  format={a.format as 'HDR' | 'EXR'}
                  exposure={envExposure}
                />
                <div className="v3-bar">
                  <label className="v3-chip">
                    曝光
                    <input
                      type="range"
                      min="0"
                      max="4"
                      step="0.05"
                      value={envExposure}
                      onChange={(event) => {
                        const next = Number(event.currentTarget.value)
                        setEnvExposure(next)
                        void window.windowApi.state.set('viewerExposure', String(next))
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : a.type === 'image' ? (
              prepared?.error ? (
                <div className="pv3d">
                  <MediaFallback label={prepared.error} />
                  <div className="v3-bar">
                    <button className="v3-chip" onClick={retryPreview}>重试</button>
                    <button className="v3-chip" onClick={openExternally}>外部打开</button>
                  </div>
                </div>
              ) : (
                <MediaImg
                  src={a.dbId != null ? refreshedImageViewUrl : `/@fs/${a.previewUrl ?? ''}`}
                  name={a.name}
                />
              )
            ) : (
              <div className="pv-video-shell">
                <div className="pv-video-surface">
                  {prepared?.error ? (
                    <div className="pv3d">
                      <MediaFallback label={prepared.error} />
                      <div className="v3-bar">
                        <button className="v3-chip" onClick={retryPreview}>重试</button>
                        <button className="v3-chip" onClick={openExternally}>外部打开</button>
                      </div>
                    </div>
                  ) : videoSrc ? (
                    <VideoElement src={videoSrc} playback={playback} />
                  ) : (
                    <div className="pv-loading">
                      {prepared?.progress == null
                        ? '正在准备视频…'
                        : `转码中 ${Math.round(prepared.progress)}%`}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>

      {!isStyle && !isModel ? (
        <div className="pv-dock">
          <div className="pv-meta-row">
            <div className="pv-meta-copy">
              <strong title={a.name}>{a.name}</strong>
              <span className="sep">·</span>
              <span title={assetMeta}>{assetMeta}</span>
            </div>
            {a.format === 'AI' && prepared?.pages ? (
              <div className="v3-bar">
                <button
                  className="v3-chip"
                  disabled={pdfPage <= 1}
                  onClick={() => setPdfPage((page) => Math.max(1, page - 1))}
                  aria-label="上一页"
                  title="上一页"
                >
                  <Icon name="arr-l" />
                </button>
                <span className="v3-chip">{pdfPage} / {prepared.pages}</span>
                <button
                  className="v3-chip"
                  disabled={pdfPage >= prepared.pages}
                  onClick={() => setPdfPage((page) => Math.min(prepared.pages!, page + 1))}
                  aria-label="下一页"
                  title="下一页"
                >
                  <Icon name="arr-r" />
                </button>
              </div>
            ) : null}
          </div>
          {isVideo ? (
            <VideoControls v={playback} fps={a.fps} fullscreen={fsNow} onFullscreen={toggleFullscreen} />
          ) : null}
        </div>
      ) : null}

      <Filmstrip />
    </div>
  )
}
