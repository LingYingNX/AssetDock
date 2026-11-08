import { useEffect, useRef, type RefObject } from 'react'
import { nextMenuIndex } from '../data/menu-focus'

const FOCUSABLE = [
  '[role="menuitem"]:not([disabled])',
  '[role="menuitemradio"]:not([disabled])',
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** 同一时刻只让最上层浮层处理键盘,避免嵌套菜单的 Esc 被两层同时消费 */
const layers: symbol[] = []

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
}

function isEditable(el: HTMLElement | null): boolean {
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/**
 * 浮层的键盘入口。
 *
 * 不在挂载时抢焦点:筛选菜单会因悬停自动打开,抢焦点等于让鼠标移动改变键盘位置。
 * 用户按 Tab/方向键时再进入面板;Esc 一律关闭并把焦点还给打开前的元素。
 */
export function useMenuFocus(
  active: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  mode: 'menu' | 'dialog' = 'menu',
  fallbackFocus?: () => HTMLElement | null
): void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const layer = useRef(Symbol('menu-layer'))
  const previous = useRef<HTMLElement | null>(null)
  const fallbackRef = useRef(fallbackFocus)
  fallbackRef.current = fallbackFocus

  useEffect(() => {
    if (!active) return
    const root = rootRef.current
    if (!root) return
    const before = document.activeElement
    previous.current = before instanceof HTMLElement ? before : null
    layers.push(layer.current)

    const restore = (): void => {
      const fallback = fallbackRef.current?.() ?? null
      const target = previous.current?.isConnected ? previous.current : fallback
      target?.focus()
    }

    const onKey = (event: KeyboardEvent): void => {
      if (layers[layers.length - 1] !== layer.current) return
      const items = focusable(root)
      if (items.length === 0) return
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const inside = current != null && root.contains(current)

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        restore()
        return
      }

      if (event.key === 'Tab') {
        const first = items[0]
        const last = items[items.length - 1]
        if (!inside) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
          return
        }
        if (mode === 'dialog') {
          if (!event.shiftKey && current === last) {
            event.preventDefault()
            first.focus()
          } else if (event.shiftKey && current === first) {
            event.preventDefault()
            last.focus()
          }
          return
        }
        if ((!event.shiftKey && current === last) || (event.shiftKey && current === first)) {
          event.preventDefault()
          closeRef.current()
          restore()
        }
        return
      }

      if (mode !== 'menu' || isEditable(current)) return
      const index = current != null ? items.indexOf(current) : -1
      const next = nextMenuIndex(event.key, index, items.length)
      if (next == null) return
      event.preventDefault()
      items[next].focus()
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      const at = layers.indexOf(layer.current)
      if (at >= 0) layers.splice(at, 1)
      document.removeEventListener('keydown', onKey, true)
      if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) restore()
    }
  }, [active, mode, rootRef])
}
