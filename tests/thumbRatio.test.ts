import { describe, expect, it } from 'vitest'
import { FALLBACK_THUMB_AR, MAX_THUMB_AR, MIN_THUMB_AR, thumbRatio } from '../src/renderer/src/data/thumb-ratio'

describe('thumbRatio', () => {
  it('keeps ordinary ratios untouched', () => {
    expect(thumbRatio(1920, 1080)).toBeCloseTo(16 / 9, 6)
    expect(thumbRatio(1080, 1350)).toBeCloseTo(0.8, 6)
  })

  it('clamps ultra-wide frames instead of letting the thumb collapse to a line', () => {
    // 1200x172 的字幕条:原始比例近 7:1,不收敛的话 232px 列宽下只剩 33px 高
    expect(thumbRatio(1200, 172)).toBeCloseTo(MAX_THUMB_AR, 6)
    expect(232 / thumbRatio(1200, 172)!).toBeGreaterThan(90)
  })

  it('clamps tall screenshots that would otherwise stretch a waterfall column', () => {
    expect(thumbRatio(1080, 6400)).toBeCloseTo(MIN_THUMB_AR, 6)
  })

  it('keeps 9:16 portrait video inside the bound', () => {
    expect(thumbRatio(1080, 1920)).toBeCloseTo(0.5625, 6)
  })

  it('returns undefined without a size so the CSS fallback applies', () => {
    expect(thumbRatio(undefined, 1080)).toBeUndefined()
    expect(thumbRatio(1920, undefined)).toBeUndefined()
    expect(thumbRatio(0, 0)).toBeUndefined()
    expect(FALLBACK_THUMB_AR).toBeCloseTo(4 / 3, 6)
  })
})