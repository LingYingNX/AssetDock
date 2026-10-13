/**
 * 「这张卡进过视口了吗」—— 缩略图与三维上下文都按视口活跃度分层。
 *
 * 卡片数量可以到几千张，所以这里只保留一个共享的 IntersectionObserver：
 * 每张卡注册时记一个回调，元素第一次进入视口（外扩 200px，稍微提前一点，
 * 滚动过来时不会先看到占位底）就触发一次并注销。
 *
 * 只在首次进入时触发，往后不再收回：来回滚动不该反复销毁/重建三维上下文，
 * 也不该让已经解码好的缩略图重新变回占位。
 *
 * 环境没有 IntersectionObserver 时（例如单元测试的 node 环境）直接同步回调，
 * 宁可多请求一次，也不能把卡片留在永久空白的占位底上。
 */
const callbacks = new Map<Element, () => void>()
let observer: IntersectionObserver | null = null

function ensureObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  if (observer) return observer
  const created = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const cb = callbacks.get(entry.target)
        if (!cb) continue
        callbacks.delete(entry.target)
        created.unobserve(entry.target)
        cb()
      }
    },
    { rootMargin: '200px 0px' }
  )
  observer = created
  return created
}

/** 元素首次出现在视口（或视口外 200px 内）时回调一次；返回清理函数。 */
export function onceInView(el: Element, cb: () => void): () => void {
  const io = ensureObserver()
  if (!io) {
    cb()
    return () => {}
  }
  callbacks.set(el, cb)
  io.observe(el)
  return () => {
    callbacks.delete(el)
    io.unobserve(el)
  }
}
