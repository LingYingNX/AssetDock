import { describe, expect, it } from 'vitest'
import { clampPanOffset } from '../src/renderer/src/data/pan-clamp'

describe('image pan clamp', () => {
  it('locks the offset while the image is not zoomed in', () => {
    expect(clampPanOffset({ x: 40, y: -20 }, 1, 0.5, 0.5, 800, 600)).toEqual({ x: 0, y: 0 })
    expect(clampPanOffset({ x: 40, y: -20 }, 0.5, 0.2, 0.8, 800, 600)).toEqual({ x: 0, y: 0 })
  })

  it('allows only the overflow that exists on each side of the origin', () => {
    // 2x:800x600 → 溢出 800x600;原点 20%/80% → 右侧 160、左侧 640
    const clamped = clampPanOffset({ x: 900, y: -900 }, 2, 0.2, 0.8, 800, 600)
    expect(clamped.x).toBe(160)
    expect(clamped.y).toBeCloseTo(-120)
  })

  it('centres the bounds when the origin is the centre', () => {
    expect(clampPanOffset({ x: 9999, y: -9999 }, 3, 0.5, 0.5, 400, 300)).toEqual({ x: 400, y: -300 })
  })
})
