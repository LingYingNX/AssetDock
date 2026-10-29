/**
 * 事件目标是否处在「按键属于输入语义」的上下文里。
 *
 * 两种地方:
 * - 可编辑控件:`input` / `textarea`,以及 `contenteditable` 元素本身与它的后代
 * - 模态对话框内部:标记了 `aria-modal="true"` 的浮层
 *
 * 灯箱同样用 `role="dialog"`,但它是 `aria-modal="false"`(只有全屏时才是模态),
 * 所以灯箱里的 ←/→ 与 Enter 仍按快捷键处理 —— 只有焦点落进灯箱自己的输入框时才让位。
 *
 * 只用 `tagName` / `getAttribute` / `parentElement` 三个属性向上走,所以脱离真实 DOM
 * 也能直接断言(测试环境没有 jsdom)。
 */
export function isEditableTarget(el: Element | null): boolean {
  for (let node: Element | null = el; node != null; node = node.parentElement) {
    /* 事件目标不一定是元素:合成事件会把 target 设成 window/document,那里没有 getAttribute */
    if (typeof node.getAttribute !== 'function') return false
    const tag = node.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true
    if (node.getAttribute('aria-modal') === 'true') return true
    const editable = node.getAttribute('contenteditable')
    if (editable == null) continue
    const value = editable.toLowerCase()
    if (value === 'inherit') continue
    /* "false" 是显式切断:它下面的内容不可编辑,也不再往上看祖先的 "true" */
    return value !== 'false'
  }
  return false
}
