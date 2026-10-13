import { describe, expect, it, vi } from 'vitest'
import {
  createFrameBatcher,
  mergeAssetDelta,
  toAssetDelta,
  type AssetDelta
} from '../src/renderer/src/data/frame-batch'

describe('frame batch: asset deltas', () => {
  it('collapses a burst inside one frame into a single reload', () => {
    const commits: AssetDelta[] = []
    const queue: (() => void)[] = []
    const batcher = createFrameBatcher<AssetDelta>(mergeAssetDelta, (d) => commits.push(d), (run) => queue.push(run), () => 0)

    for (let i = 0; i < 20; i++) batcher.push({ libraryId: 7, assetIds: [i] })
    expect(queue).toHaveLength(1)
    expect(commits).toHaveLength(0)

    queue.shift()?.()

    expect(commits).toHaveLength(1)
    expect(commits[0].libraryId).toBe(7)
    expect(commits[0].assetIds).toHaveLength(20)
    expect(commits[0].assetIds).toContain(19)
  })

  it('degrades the whole frame to a full reload when any event carries no ids', () => {
    const commits: AssetDelta[] = []
    const queue: (() => void)[] = []
    const batcher = createFrameBatcher<AssetDelta>(mergeAssetDelta, (d) => commits.push(d), (run) => queue.push(run), () => 0)

    batcher.push({ libraryId: 7, assetIds: [1, 2] })
    batcher.push({ libraryId: 7, assetIds: null })
    queue.shift()?.()

    expect(commits).toEqual([{ libraryId: 7, assetIds: null }])
  })

  it('deduplicates ids repeated across events in the same frame', () => {
    const commits: AssetDelta[] = []
    const queue: (() => void)[] = []
    const batcher = createFrameBatcher<AssetDelta>(mergeAssetDelta, (d) => commits.push(d), (run) => queue.push(run), () => 0)

    batcher.push({ libraryId: 7, assetIds: [1, 2] })
    batcher.push({ libraryId: 7, assetIds: [2, 3] })
    queue.shift()?.()

    expect(commits[0].assetIds).toEqual([1, 2, 3])
  })

  it('keeps the newest library when events from two libraries land in one frame', () => {
    const commits: AssetDelta[] = []
    const queue: (() => void)[] = []
    const batcher = createFrameBatcher<AssetDelta>(mergeAssetDelta, (d) => commits.push(d), (run) => queue.push(run), () => 0)

    batcher.push({ libraryId: 1, assetIds: [1] })
    batcher.push({ libraryId: 2, assetIds: [9] })
    queue.shift()?.()

    expect(commits).toEqual([{ libraryId: 2, assetIds: [9] }])
  })

  it('holds a later frame separately instead of folding it into the first', () => {
    const commits: AssetDelta[] = []
    const queue: (() => void)[] = []
    const batcher = createFrameBatcher<AssetDelta>(mergeAssetDelta, (d) => commits.push(d), (run) => queue.push(run), () => 0)

    batcher.push({ libraryId: 7, assetIds: [1] })
    queue.shift()?.()
    batcher.push({ libraryId: 7, assetIds: [2] })
    expect(queue).toHaveLength(1)
    queue.shift()?.()

    expect(commits).toHaveLength(2)
    expect(commits[1].assetIds).toEqual([2])
  })

  it('drops the pending commit on cancel', () => {
    const commits: AssetDelta[] = []
    const queue: (() => void)[] = []
    const batcher = createFrameBatcher<AssetDelta>(mergeAssetDelta, (d) => commits.push(d), (run) => queue.push(run), () => 0)

    batcher.push({ libraryId: 7, assetIds: [1] })
    batcher.cancel()
    queue.shift()?.()

    expect(commits).toHaveLength(0)
  })

  it('normalises an empty or malformed id list into the full-reload form', () => {
    expect(toAssetDelta({ libraryId: 3, assetIds: [] })).toEqual({ libraryId: 3, assetIds: null })
    expect(toAssetDelta({ libraryId: 3 })).toEqual({ libraryId: 3, assetIds: null })
    expect(toAssetDelta({ libraryId: 3, assetIds: [4, 4, 5] })).toEqual({ libraryId: 3, assetIds: [4, 5] })
  })
})

describe('frame batch: latest value wins', () => {
  it('commits only the final progress snapshot of a burst', () => {
    const commits: { done: number; total: number }[] = []
    const queue: (() => void)[] = []
    const batcher = createFrameBatcher<{ done: number; total: number }>(
      (_pending, next) => next,
      (v) => commits.push(v),
      (run) => queue.push(run),
      () => 0
    )

    for (let i = 0; i < 50; i++) batcher.push({ done: i, total: 50 })
    queue.shift()?.()

    expect(commits).toEqual([{ done: 49, total: 50 }])
  })
})

describe('frame batch: default scheduler', () => {
  it('falls back to requestAnimationFrame on the window', () => {
    const raf = vi.fn(() => 11)
    const caf = vi.fn()
    vi.stubGlobal('window', { requestAnimationFrame: raf, cancelAnimationFrame: caf })
    const commits: AssetDelta[] = []
    const batcher = createFrameBatcher<AssetDelta>(mergeAssetDelta, (d) => commits.push(d))

    batcher.push({ libraryId: 7, assetIds: [1] })
    expect(raf).toHaveBeenCalledTimes(1)

    batcher.cancel()
    expect(caf).toHaveBeenCalledWith(11)
    expect(commits).toHaveLength(0)
  })
})
