import { describe, expect, it } from 'vitest'
import {
  REEL_OVERSCAN,
  REEL_PITCH,
  scrollLeftForIndex,
  stripWindow
} from '../src/renderer/src/data/strip-window'

describe('filmstrip windowing', () => {
  it('renders the viewport plus overscan on both sides', () => {
    // 视口宽 840 → 8 格(按 REEL_PITCH=103);首个可见格是第 100 格
    const w = stripWindow(100 * REEL_PITCH, 840, 4000)
    expect(w.start).toBe(100 - REEL_OVERSCAN)
    expect(w.end).toBe(100 + Math.ceil(840 / REEL_PITCH) + REEL_OVERSCAN)
  })

  it('clamps at the very start', () => {
    const w = stripWindow(0, 840, 4000)
    expect(w.start).toBe(0)
    expect(w.padLeft).toBe(0)
  })

  it('clamps at the very end', () => {
    const total = 4000
    const maxScroll = total * REEL_PITCH
    const w = stripWindow(maxScroll, 840, total)
    expect(w.end).toBe(total)
    expect(w.padRight).toBe(0)
  })

  it('keeps padding consistent with the skipped reels', () => {
    // 占位块宽度必须正好等于被跳过的格数 × 占宽,否则滚动位置与下标会错位
    const w = stripWindow(50 * REEL_PITCH, 600, 3000)
    expect(w.padLeft).toBe(w.start * REEL_PITCH)
    expect(w.padRight).toBe((3000 - w.end) * REEL_PITCH)
  })

  it('never lets the window invert or exceed the list', () => {
    for (const scroll of [0, 5, 999, 100_000, 10_000_000]) {
      const w = stripWindow(scroll, 840, 300)
      expect(w.start).toBeGreaterThanOrEqual(0)
      expect(w.end).toBeGreaterThanOrEqual(w.start)
      expect(w.end).toBeLessThanOrEqual(300)
    }
  })

  it('returns an empty window for an empty list', () => {
    expect(stripWindow(0, 840, 0)).toEqual({ start: 0, end: 0, padLeft: 0, padRight: 0 })
  })

  it('treats a negative scroll as the start', () => {
    const w = stripWindow(-500, 840, 3000)
    expect(w.start).toBe(0)
  })

  it('centres the target reel when there is room', () => {
    const left = scrollLeftForIndex(200, 840, 3000)
    // 目标格中点应落在视口中心附近(±半格)
    const reelCentre = 200 * REEL_PITCH + REEL_PITCH / 2
    expect(Math.abs(reelCentre - (left + 420))).toBeLessThanOrEqual(REEL_PITCH)
  })

  it('centres on the item itself when the pitch differs from the item width', () => {
    // 间距让 pitch 大于格宽时,居中要对准格子的中点而不是 pitch 的中点
    const left = scrollLeftForIndex(200, 840, 3000, REEL_PITCH, 96)
    const itemCentre = 200 * REEL_PITCH + 48
    expect(Math.abs(itemCentre - (left + 420))).toBeLessThanOrEqual(1)
  })

  it('clamps centring at both ends', () => {
    expect(scrollLeftForIndex(0, 840, 3000)).toBe(0)
    const last = scrollLeftForIndex(2999, 840, 3000)
    expect(last).toBe(3000 * REEL_PITCH - 840)
  })

  it('handles a viewport wider than the whole strip', () => {
    expect(scrollLeftForIndex(5, 10_000, 10)).toBe(0)
  })

  it('keeps the first and last reel centred when end padding is available', () => {
    const viewport = 840
    const total = 20
    const itemW = 96
    const padStart = (viewport - itemW) / 2
    const padEnd = (viewport - itemW - 14) / 2

    expect(scrollLeftForIndex(0, viewport, total, REEL_PITCH, itemW, padStart, padEnd)).toBe(0)

    const lastTarget = scrollLeftForIndex(total - 1, viewport, total, REEL_PITCH, itemW, padStart, padEnd)
    const lastCentre = padStart + (total - 1) * REEL_PITCH + itemW / 2
    expect(Math.abs(lastCentre - (lastTarget + viewport / 2))).toBeLessThanOrEqual(0.01)
  })

  it('includes the centring pads in window placeholders', () => {
    const w = stripWindow(0, 840, 3000, REEL_PITCH, REEL_OVERSCAN, 372)
    expect(w.padLeft).toBe(372)
    const tail = stripWindow(0, 840, 1, REEL_PITCH, REEL_OVERSCAN, 372, 365)
    expect(tail.padRight).toBe(365)
  })
})
