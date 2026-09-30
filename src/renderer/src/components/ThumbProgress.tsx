import { useUI } from '../store/ui'

/**
 * 缩略图全量生成的悬浮进度条:右下角浮层,只在生成期间出现,完成即淡出。
 * 不占布局、不拦截指针,避免打断浏览;进度来自主进程 thumbs:progress 事件。
 */
export function ThumbProgress(): React.JSX.Element | null {
  const progress = useUI((s) => s.thumbProgress)
  if (!progress || progress.total <= 0) return null

  const pct = Math.min(100, Math.round((progress.done / progress.total) * 100))
  return (
    <div className="thumb-progress glass-panel" role="status" aria-live="polite">
      <div className="tp-head">
        <span className="tp-label">正在生成缩略图</span>
        <span className="tp-count">
          {progress.done} / {progress.total}
        </span>
      </div>
      <div className="tp-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="tp-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}