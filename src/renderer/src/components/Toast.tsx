import { useUI } from '../store/ui'
import { Icon } from './Icons'

/**
 * 一次性操作提示:右下角浮层,2.6s 后自动消失。
 *
 * 与缩略图进度同处右下,靠下排列以免互相遮挡;不拦截指针,不打断浏览。
 * 只用于「用户看不见结果」的操作(复制、重命名失败等),成功即静默的情形不必打扰。
 */
export function Toast(): React.JSX.Element | null {
  const toast = useUI((s) => s.toast)
  if (!toast) return null
  return (
    <div className={`app-toast glass-panel${toast.kind === 'warn' ? ' warn' : ''}`} role="status" aria-live="polite">
      <Icon name={toast.kind === 'warn' ? 'info' : 'check'} />
      <span>{toast.text}</span>
    </div>
  )
}
