import { useEffect, useState } from 'react'
import { useUI } from '../store/ui'
import { Icon } from './Icons'

/**
 * 一次性操作提示:右下角浮层,2.6s 后自动消失。
 *
 * 与缩略图进度同处右下,靠下排列以免互相遮挡;不拦截指针,不打断浏览。
 * 只用于「用户看不见结果」的操作(复制、重命名失败等),成功即静默的情形不必打扰。
 *
 * 提示是「看一眼就走」的元素,消失速度比出现更影响体感:原来 store 把 toast 置空后
 * 组件立刻 return null,是 0ms 硬闪。改成挂载与显示分离——置空后先播 140ms 淡出,
 * 再由定时器卸载。定时器不能省:reduced-motion 下全局禁掉了过渡,
 * transitionend 永不触发,只等事件会让提示永远停在屏幕上。
 */
export function Toast(): React.JSX.Element | null {
  const toast = useUI((s) => s.toast)
  const [mounted, setMounted] = useState(toast != null)
  const [shown, setShown] = useState(false)
  /* 保留最后一帧内容:退场期间 store 里的 toast 已经为 null,没有它文字会先被抽空 */
  const [last, setLast] = useState(toast)

  useEffect(() => {
    if (toast) {
      setLast(toast)
      setMounted(true)
      return
    }
    setShown(false)
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 180)
    return () => window.clearTimeout(t)
  }, [toast, mounted])

  useEffect(() => {
    if (!mounted || !toast) return
    // 下一帧再置 shown,让「已挂载但透明」的那一帧成为过渡起点
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [mounted, toast])

  if (!mounted || !last) return null
  return (
    <div
      className={`app-toast glass-panel${last.kind === 'warn' ? ' warn' : ''}${shown ? ' show' : ''}`}
      role="status"
      aria-live="polite"
    >
      <Icon name={last.kind === 'warn' ? 'info' : 'check'} />
      <span>{last.text}</span>
    </div>
  )
}
