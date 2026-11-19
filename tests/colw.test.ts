import { describe, expect, it } from 'vitest'
import {
  COLW_DEFAULT,
  COLW_MAX,
  COLW_MIN,
  COLW_STEPS,
  clampColw,
  colwToSlider,
  fitColumns,
  sliderToColw
} from '../src/renderer/src/data/colw'

describe('缩略图列宽刻度', () => {
  it('列宽下限固定为 170px', () => {
    expect(COLW_MIN).toBe(170)
    expect(sliderToColw(0)).toBe(170)
  })

  it('两端与默认值都能来回换算', () => {
    expect(sliderToColw(0)).toBe(COLW_MIN)
    expect(sliderToColw(COLW_STEPS)).toBe(COLW_MAX)
    expect(colwToSlider(COLW_MIN)).toBe(0)
    expect(colwToSlider(COLW_MAX)).toBe(COLW_STEPS)
    expect(sliderToColw(colwToSlider(COLW_DEFAULT))).toBe(COLW_DEFAULT)
  })

  it('越界值与非法值收敛到合法区间', () => {
    expect(clampColw(9999)).toBe(COLW_MAX)
    expect(clampColw(-1)).toBe(COLW_MIN)
    expect(clampColw(Number.NaN)).toBe(COLW_DEFAULT)
    expect(sliderToColw(-5)).toBe(COLW_MIN)
    expect(sliderToColw(COLW_STEPS + 5)).toBe(COLW_MAX)
  })

  it('刻度单调递增', () => {
    let prev = 0
    for (let step = 0; step <= COLW_STEPS; step++) {
      const value = sliderToColw(step)
      expect(value).toBeGreaterThanOrEqual(prev)
      prev = value
    }
  })

  it('每个整数列宽都能经滑块往返一次', () => {
    for (let width = COLW_MIN; width <= COLW_MAX; width++) {
      expect(sliderToColw(colwToSlider(width))).toBe(width)
    }
  })
})

describe('虚拟化列宽摊分', () => {
  it('列数确定后把剩余宽度摊回每列', () => {
    const { cols, width } = fitColumns(1147, 170, 10)
    expect(cols).toBe(6)
    const used = cols * width + (cols - 1) * 10
    expect(used).toBeLessThanOrEqual(1147)
    expect(1147 - used).toBeLessThan(cols)
  })

  it('不足一列时铺满容器', () => {
    expect(fitColumns(150, 170, 10)).toEqual({ cols: 1, width: 150 })
  })
})