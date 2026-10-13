import { describe, expect, it } from 'vitest'
import { marqueeHits, marqueeRect, type MarqueeCandidate, type Rect } from '../src/renderer/src/data/marquee'

const card = (id: string, left: number, top: number, right: number, bottom: number): MarqueeCandidate => ({
  id,
  rect: { left, top, right, bottom }
})

const box = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom })

describe('marquee hit test', () => {
  it('counts a candidate that overlaps the box', () => {
    expect(marqueeHits(box(50, 50, 150, 150), [card('a', 0, 0, 100, 100)])).toEqual(['a'])
  })

  it('does not count a candidate that only touches the box edge', () => {
    // 正好贴边 = 零重叠面积,边框擦过卡片不该把它选进来
    expect(marqueeHits(box(0, 0, 100, 100), [card('a', 100, 0, 200, 100)])).toEqual([])
    expect(marqueeHits(box(0, 0, 100, 100), [card('a', 0, 100, 100, 200)])).toEqual([])
  })

  it('counts a candidate fully inside the box', () => {
    expect(marqueeHits(box(0, 0, 100, 100), [card('a', 20, 20, 40, 40)])).toEqual(['a'])
  })

  it('counts a box fully inside one candidate', () => {
    expect(marqueeHits(box(30, 30, 40, 40), [card('a', 0, 0, 100, 100)])).toEqual(['a'])
  })

  it('drops candidates that do not overlap at all', () => {
    expect(marqueeHits(box(0, 0, 100, 100), [card('a', 300, 300, 400, 400)])).toEqual([])
    expect(marqueeHits(box(0, 0, 100, 100), [card('a', 0, 200, 100, 300)])).toEqual([])
  })

  it('returns an empty list for an empty candidate set', () => {
    expect(marqueeHits(box(0, 0, 100, 100), [])).toEqual([])
  })

  it('keeps the candidate order and skips the misses', () => {
    const candidates = [card('a', 0, 0, 50, 50), card('b', 300, 300, 350, 350), card('c', 40, 40, 60, 60)]
    expect(marqueeHits(box(0, 0, 100, 100), candidates)).toEqual(['a', 'c'])
  })

  it('normalises the box for either drag direction', () => {
    const expected = { left: 20, top: 40, right: 100, bottom: 100 }
    expect(marqueeRect(100, 100, 20, 40)).toEqual(expected)
    expect(marqueeRect(20, 40, 100, 100)).toEqual(expected)
  })
})
