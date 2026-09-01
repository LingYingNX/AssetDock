import { describe, it, expect } from 'vitest'
import { parseVideoMetaText } from '../src/main/services/videoMeta'

const SAMPLE = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':
  Duration: 00:00:20.04, start: 0.000000, bitrate: 6837 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1200x172 [SAR 1:1 DAR 300:43], 6827 kb/s, 25 fps, 25 tbr, 12800 tbn (default)`

describe('videoMeta text parse', () => {
  it('提取时长/尺寸/编码/帧率', () => {
    const m = parseVideoMetaText(SAMPLE)
    expect(m.duration).toBeCloseTo(20.04, 2)
    expect(m.width).toBe(1200)
    expect(m.height).toBe(172)
    expect(m.codec).toBe('h264')
    expect(m.fps).toBe(25)
  })
  it('无匹配返回空对象', () => {
    expect(parseVideoMetaText('garbage')).toEqual({ duration: undefined, codec: undefined, fps: undefined })
  })
})
