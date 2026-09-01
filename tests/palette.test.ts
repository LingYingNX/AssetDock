import { describe, it, expect } from 'vitest'
import { extractPalette } from '../src/main/services/palette'

function raw(w: number, h: number, rgb: [number, number, number]): Buffer {
  const buf = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = rgb[0]
    buf[i * 3 + 1] = rgb[1]
    buf[i * 3 + 2] = rgb[2]
  }
  return buf
}

describe('k-means palette (worker_threads)', () => {
  it('纯色图 → 单色 100%', async () => {
    const p = await extractPalette(raw(64, 64, [30, 120, 220]), 64, 64)
    expect(p).toHaveLength(1)
    expect(p[0].ratio).toBe(100)
    expect(p[0].hex).toBe('#1E78DC')
  })

  it('双色图 → 两主色,占比约半', async () => {
    const w = 64, h = 64
    const buf = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        const c = x < 32 ? [255, 0, 0] : [0, 0, 255]
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]
      }
    }
    const p = await extractPalette(buf, w, h)
    expect(p.length).toBe(2)
    const red = p.find((c) => c.hex === '#FF0000')
    const blue = p.find((c) => c.hex === '#0000FF')
    expect(red && blue).toBeTruthy()
    expect(Math.abs((red?.ratio ?? 0) - 50)).toBeLessThanOrEqual(5)
  })
})
