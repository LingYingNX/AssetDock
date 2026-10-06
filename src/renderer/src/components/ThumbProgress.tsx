import { useEffect, useState } from 'react'
import { useUI } from '../store/ui'

/**
 * 缩略图全量生成的悬浮进度条:右下角浮层,只在生成期间出现,完成即淡出。
 * 不占布局、不拦截指针,避免打断浏览;进度来自主进程 thumbs:progress 事件。
 *
 * 与 Toast 同一类问题:原来生成一结束就 return null,元素被卸载,
 * CSS 里写好的淡出永远没机会播放。挂载与显形分离,退场交给定时器兜底。
 */
export function ThumbProgress(): React.JSX.Element | null {
  const progress = useUI((s) => s.thumbProgress)
  const active = progress != null && progress.total > 0
  const [mounted, setMounted] = useState(active)
  const [shown, setShown] = useState(false)
  /* 退场期间 store 可能已清空,留一份最后进度供淡出期间继续显示 */
  const [last, setLast] = useState(progress)

  useEffect(() => {
    if (active) {
      setLast(progress)
      setMounted(true)
      return
    }
    setShown(false)
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 260)
    return () => window.clearTimeout(t)
  }, [active, progress, mounted])

  useEffect(() => {
    if (!mounted || !active) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [mounted, active])

  if (!mounted || !last || last.total <= 0) return null

  const pct = Math.min(100, Math.round((last.done / last.total) * 100))
  return (
    <div
      className={`thumb-progress glass-panel${shown ? ' show' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="tp-head">
        <span className="tp-label">正在生成缩略图</span>
        <span className="tp-count">
          {last.done} / {last.total}
        </span>
      </div>
      <div className="tp-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="tp-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
