import { describe, expect, it, vi } from 'vitest'

class FakeObserver {
  static instances: FakeObserver[] = []
  targets: Element[] = []
  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeObserver.instances.push(this)
  }

  observe(el: Element): void {
    this.targets.push(el)
  }

  unobserve(el: Element): void {
    this.targets = this.targets.filter((t) => t !== el)
  }

  disconnect(): void {
    this.targets = []
  }

  intersect(el: Element): void {
    this.callbackWith(el, true)
  }

  callbackWith(el: Element, isIntersecting: boolean): void {
    this.callback(
      [{ target: el, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
}

const load = async (): Promise<typeof import('../src/renderer/src/data/viewport')> => {
  vi.resetModules()
  return import('../src/renderer/src/data/viewport')
}

const el = (): Element => ({ tagName: 'DIV' }) as unknown as Element

describe('viewport activation', () => {
  it('fires immediately when the environment has no IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { onceInView } = await load()
    const hit = vi.fn()

    const stop = onceInView(el(), hit)

    // 宁可多请求一次,也不能把卡片留在永久空白的占位底上
    expect(hit).toHaveBeenCalledTimes(1)
    expect(() => stop()).not.toThrow()
  })

  it('defers the callback until the element first intersects', async () => {
    FakeObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const { onceInView } = await load()
    const target = el()
    const hit = vi.fn()

    onceInView(target, hit)

    const io = FakeObserver.instances[0]
    expect(io.targets).toContain(target)
    expect(hit).not.toHaveBeenCalled()

    io.intersect(target)

    expect(hit).toHaveBeenCalledTimes(1)
    // 一旦进过视口就不再观察:来回滚动不该反复建/销三维上下文
    expect(io.targets).not.toContain(target)
  })

  it('ignores a non-intersecting entry', async () => {
    FakeObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const { onceInView } = await load()
    const target = el()
    const hit = vi.fn()
    onceInView(target, hit)

    const io = FakeObserver.instances[0]
    io.callbackWith(target, false)

    expect(hit).not.toHaveBeenCalled()
    expect(io.targets).toContain(target)
  })

  it('reuses a single observer for every card', async () => {
    FakeObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const { onceInView } = await load()

    onceInView(el(), vi.fn())
    onceInView(el(), vi.fn())
    onceInView(el(), vi.fn())

    // 三千张卡不该造三千个观察器
    expect(FakeObserver.instances).toHaveLength(1)
  })

  it('stops delivering after cleanup', async () => {
    FakeObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const { onceInView } = await load()
    const target = el()
    const hit = vi.fn()

    const stop = onceInView(target, hit)
    stop()
    FakeObserver.instances[0].intersect(target)

    expect(hit).not.toHaveBeenCalled()
  })
})
