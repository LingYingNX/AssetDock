import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icons'

/** 倍速档位:慢放与快放各取常用值,1x 居中便于数一下就到 */
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

/** 秒 → m:ss(不足一小时)或 h:mm:ss */
export function formatTime(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 播放状态快照:控制条只读这一份,避免各处直接摸 DOM */
interface Snap {
  failed: boolean
  playing: boolean
  current: number
  duration: number
  volume: number
  muted: boolean
  rate: number
  buffered: number
}

const IDLE: Snap = {
  failed: false,
  playing: false,
  current: 0,
  duration: 0,
  volume: 1,
  muted: false,
  rate: 1,
  buffered: 0
}

/**
 * 把 <video> 的媒体事件收敛成一份快照。
 *
 * 进度条/音量/倍速这三样在浏览器原生 controls 里是整体的,拆不开也改不了样式,
 * 所以自行托管:素材切换时同一节点会换 src,故按 src 复位,不留上一条视频的进度。
 */
export function useVideoPlayback(src: string) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [snap, setSnap] = useState<Snap>(IDLE)

  const sync = useCallback((): void => {
    const v = ref.current
    if (!v) return
    setSnap({
      failed: false,
      playing: !v.paused && !v.ended,
      current: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      volume: v.volume,
      muted: v.muted,
      rate: v.playbackRate,
      buffered: v.buffered.length > 0 ? v.buffered.end(v.buffered.length - 1) : 0
    })
  }, [])

  useEffect(() => {
    setSnap(IDLE)
  }, [src])

  const toggle = useCallback((): void => {
    const v = ref.current
    if (!v) return
    if (v.paused) void v.play().catch(() => undefined)
    else v.pause()
  }, [])

  const seek = useCallback(
    (t: number): void => {
      const v = ref.current
      if (!v || !Number.isFinite(t)) return
      v.currentTime = Math.max(0, Math.min(v.duration || t, t))
      sync()
    },
    [sync]
  )

  const setVolume = useCallback(
    (vol: number): void => {
      const v = ref.current
      if (!v) return
      const next = Math.max(0, Math.min(1, vol))
      v.volume = next
      // 拖动音量意味着「我要听」,顺手解除静音;拖到 0 则视为静音
      v.muted = next === 0
      sync()
    },
    [sync]
  )

  const toggleMute = useCallback((): void => {
    const v = ref.current
    if (!v) return
    v.muted = !v.muted
    sync()
  }, [sync])

  const setRate = useCallback(
    (r: number): void => {
      const v = ref.current
      if (!v) return
      v.playbackRate = r
      sync()
    },
    [sync]
  )

  const handlers = {
    autoPlay: true,
    onLoadedMetadata: sync,
    onDurationChange: sync,
    onTimeUpdate: sync,
    onProgress: sync,
    onCanPlay: sync,
    onPlay: sync,
    onPause: sync,
    onVolumeChange: sync,
    onRateChange: sync,
    onError: () => setSnap((s) => ({ ...s, failed: true }))
  }

  return { ref, snap, toggle, seek, setVolume, toggleMute, setRate, handlers }
}

export type VideoPlayback = ReturnType<typeof useVideoPlayback>

/** 控制条上方的弹出小面板:向上弹,避免贴到窗口底边被裁掉。
 *
 * 这里同样是「挂载即显示」:原来 `if (!open) return null` 让面板在关闭瞬间消失,
 * 元素都没了,过渡无从播放。改成挂载与显形分离,关闭后留 140ms 播完淡出再卸载。
 * 不能只等 transitionend:reduced-motion 下过渡被全局移除,事件永不触发。
 */
function Pop({ open, children }: { open: boolean; children: ReactNode }): React.JSX.Element | null {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    setShown(false)
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 160)
    return () => window.clearTimeout(t)
  }, [open, mounted])

  useEffect(() => {
    if (!mounted || !open) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [mounted, open])

  if (!mounted) return null
  return (
    <div className={`pv-pop${shown ? ' show' : ''}`} role="group">
      {children}
    </div>
  )
}

/**
 * 进度条:自绘而非 input[type=range],因为要用同一根轨道同时表达已缓冲与已播放,
 * 且全局 range 样式定了固定宽度,覆盖它的代价高于直接画。
 */
function Scrubber({
  current,
  duration,
  buffered,
  onSeek
}: {
  current: number
  duration: number
  buffered: number
  onSeek: (t: number) => void
}): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const pct = duration > 0 ? (current / duration) * 100 : 0
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0

  const seekAt = useCallback(
    (clientX: number): void => {
      const el = trackRef.current
      if (!el || duration <= 0) return
      const r = el.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      onSeek(ratio * duration)
    },
    [duration, onSeek]
  )

  // 拖动期间监听挂在 window 上:指针移出进度条后仍要跟随,否则一拖快就断
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent): void => seekAt(e.clientX)
    const up = (): void => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, seekAt])

  return (
    <div
      className="pv-scrub"
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="播放进度"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(current)}
      onPointerDown={(e) => {
        e.preventDefault()
        setDragging(true)
        seekAt(e.clientX)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onSeek(current - 5)
        if (e.key === 'ArrowRight') onSeek(current + 5)
      }}
    >
      <span className="pv-scrub-buf" style={{ width: `${bufPct}%` }} />
      <span className="pv-scrub-fill" style={{ width: `${pct}%` }} />
      <span className="pv-scrub-knob" style={{ left: `${pct}%` }} />
    </div>
  )
}

/** 视频控制条:播放/进度/时长/音量/倍速 + 全屏(全屏对图片同样有效,故由外层给) */
export function VideoControls({
  v,
  fullscreen,
  onFullscreen
}: {
  v: VideoPlayback
  fullscreen: boolean
  onFullscreen: () => void
}): React.JSX.Element {
  const { snap } = v
  const [pop, setPop] = useState<'rate' | 'vol' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // 点面板外部收起:捕获阶段处理,免得先被按钮的 onClick 又切换一次
  useEffect(() => {
    if (!pop) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target
      if (t instanceof Node && rootRef.current?.contains(t)) return
      setPop(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [pop])

  const volPct = (snap.muted ? 0 : snap.volume) * 100

  return (
    <div className="pv-ctl" ref={rootRef}>
      <button className="tb-btn" title={snap.playing ? '暂停 (空格)' : '播放 (空格)'} onClick={v.toggle}>
        <Icon name={snap.playing ? 'pause' : 'play'} />
      </button>
      <span className="pv-time">{formatTime(snap.current)}</span>
      <Scrubber current={snap.current} duration={snap.duration} buffered={snap.buffered} onSeek={v.seek} />
      <span className="pv-time dim">{formatTime(snap.duration)}</span>

      {/* 右侧竖排:音量与倍速叠成一列,紧挨全屏。
          这里不放 flex:1 的占位元素——那会和进度条各吃一半剩余宽度,
          进度条本该是视频的主控件,不该被一个空 span 分走空间。 */}
      <div className="pv-rail">
        {/* 音量:悬停展开滑杆,点击图标切换静音——与常见播放器一致 */}
        <span className="pv-popwrap" onMouseEnter={() => setPop('vol')} onMouseLeave={() => setPop(null)}>
          <button className="tb-btn" title={snap.muted ? '取消静音' : '静音'} onClick={v.toggleMute}>
            <Icon name={snap.muted || snap.volume === 0 ? 'vol-x' : 'vol'} />
          </button>
          <Pop open={pop === 'vol'}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volPct)}
              aria-label="音量"
              style={{ background: `linear-gradient(90deg,var(--acc) ${volPct}%,var(--line2) ${volPct}%)` }}
              onChange={(e) => v.setVolume(Number(e.target.value) / 100)}
            />
          </Pop>
        </span>
        <span className="pv-popwrap">
          <button
            className={`pv-rate${snap.rate !== 1 ? ' on' : ''}`}
            title="播放倍速"
            onClick={() => setPop((p) => (p === 'rate' ? null : 'rate'))}
          >
            {snap.rate}x
          </button>
          <Pop open={pop === 'rate'}>
            {RATES.map((r) => (
              <button
                key={r}
                className={r === snap.rate ? 'on' : undefined}
                onClick={() => {
                  v.setRate(r)
                  setPop(null)
                }}
              >
                {r}x
              </button>
            ))}
          </Pop>
        </span>
      </div>

      <button className="tb-btn" title={fullscreen ? '退出全屏 (F)' : '全屏 (F)'} onClick={onFullscreen}>
        <Icon name={fullscreen ? 'contract' : 'expand'} />
      </button>
    </div>
  )
}
