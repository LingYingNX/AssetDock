/**
 * 把同一帧内的多次推送合并成一次处理。
 *
 * 主进程在扫描期间会连续推送 `assets:changed`(每批一次)与 `thumbs:progress`
 * (每张缩略图一次)。逐条处理意味着每来一条就重算一次素材集合、重渲染一次网格 —
 * 3000 项素材库里扫描阶段基本没有空帧可用。这里按帧边界合并:同一帧内无论来多少条,
 * 只提交一次合并后的最终值，所以既省掉中间态的重算，也不会丢掉最后的状态。
 *
 * 提交时机用 `requestAnimationFrame`，正好落在渲染前的空档;取消时连待提交值一起丢弃,
 * 避免卸载后还去改 store。
 */

/** 主进程 `assets:changed` 的载荷 */
export interface AssetDeltaEvent {
  libraryId: number
  assetIds?: number[]
}

/** 合并后的语义:`assetIds` 为 null 表示「不带 id」= 全量重载 */
export interface AssetDelta {
  libraryId: number
  assetIds: number[] | null
}

export function toAssetDelta(e: AssetDeltaEvent): AssetDelta {
  const ids = Array.isArray(e.assetIds) ? e.assetIds.filter((id) => typeof id === 'number') : []
  return { libraryId: e.libraryId, assetIds: ids.length > 0 ? [...new Set(ids)] : null }
}

/**
 * 同帧内的两条素材增量怎么合:
 * - 不同库:直接取后一条(同一时刻只有一个活动库，前一个库的事件本来就会被丢弃)
 * - 任一条是全量语义:整流退全量 —— 全量能覆盖增量，反之不行
 * - 其余:取 id 并集
 */
export function mergeAssetDelta(pending: AssetDelta, next: AssetDelta): AssetDelta {
  if (pending.libraryId !== next.libraryId) return next
  if (pending.assetIds === null || next.assetIds === null) {
    return { libraryId: next.libraryId, assetIds: null }
  }
  return { libraryId: next.libraryId, assetIds: [...new Set([...pending.assetIds, ...next.assetIds])] }
}

export interface FrameBatcher<T> {
  push: (value: T) => void
  cancel: () => void
}

/**
 * 帧边界合并器。`merge` 决定同帧内多条怎么并成一条，`commit` 只在帧边界被调用一次。
 * 测试里可以传入自己的调度函数，不依赖真实 rAF。
 */
export function createFrameBatcher<T>(
  merge: (pending: T, next: T) => T,
  commit: (value: T) => void,
  schedule: (run: () => void) => number = (run) => window.requestAnimationFrame(run),
  unschedule: (handle: number) => void = (handle) => window.cancelAnimationFrame(handle)
): FrameBatcher<T> {
  let pending: { value: T } | null = null
  let handle: number | null = null

  const flush = (): void => {
    handle = null
    if (pending === null) return
    const value = pending.value
    pending = null
    commit(value)
  }

  return {
    push: (value) => {
      pending = pending === null ? { value } : { value: merge(pending.value, value) }
      if (handle === null) handle = schedule(flush)
    },
    cancel: () => {
      if (handle !== null) unschedule(handle)
      handle = null
      pending = null
    }
  }
}
