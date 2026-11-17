import { useEffect, useState } from 'react'
import { useUI } from '../store/ui'
import { fmtCount } from '../data/query'

/**
 * 素材加载的悬浮进度条:挂在素材工作区中央偏下,只在当前库生成缩略图期间出现,完成即淡出。
 * 不占布局、不拦截指针,避免打断浏览;进度来自主进程 thumbs:progress 事件。
 *
 * 跨库移动复用同一条浮层:那是用户自己点的操作,进度挂在源库上但不看当前标签页
 * ——目标库通常不是当前页,跟着标签页过滤会让进度条干脆不出现。
 *
 * 与 Toast 同一类问题:原来生成一结束就 return null,元素被卸载,
 * CSS 里写好的淡出永远没机会播放。挂载与显形分离,退场交给定时器兜底。
 */
export function ThumbProgress(): React.JSX.Element | null {
  const progress = useUI((s) => s.thumbProgress)
  const transfer = useUI((s) => s.transferProgress)
  const activeLibraryId = useUI((s) => s.tabs.find((t) => t.id === s.activeTabId)?.libraryId ?? null)
  const current = transfer ?? (progress != null && progress.libraryId === activeLibraryId ? progress : null)
  const label = transfer != null ? '正在移动素材' : '正在加载素材'
  const active = current != null && current.total > 0
  const [mounted, setMounted] = useState(active)
  const [shown, setShown] = useState(false)
  /* 退场期间 store 可能已清空,留一份最后进度供淡出期间继续显示 */
  const [last, setLast] = useState(current)

  useEffect(() => {
    if (active) {
      setLast(current)
      setMounted(true)
      return
    }
    setShown(false)
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 220)
    return () => window.clearTimeout(t)
  }, [active, current, mounted])

  useEffect(() => {
    if (!mounted || !active) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [mounted, active])

  if (!mounted || !last || last.total <= 0) return null

  const pct = Math.max(0, Math.min(100, Math.round((last.done / last.total) * 100)))
  return (
    <div
      className={`thumb-progress${shown ? ' show' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="tp-head">
        <span className="tp-label">
          {label} · {fmtCount(last.done)} / {fmtCount(last.total)} 项
        </span>
        <span className="tp-percent">{pct}%</span>
      </div>
      <div
        className="tp-track"
        role="progressbar"
        aria-label={transfer != null ? '跨库移动进度' : '素材加载进度'}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`已处理 ${fmtCount(last.done)} 项，共 ${fmtCount(last.total)} 项`}
      >
        <div className="tp-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
