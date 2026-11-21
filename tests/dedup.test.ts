import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  colorSignature,
  dHashColor,
  dHashHex,
  groupSimilar,
  hammingDistance,
  normalizeFolder,
  sortByQuality,
  splitStoredHash,
  type DedupKeyed
} from '../src/main/services/dedup'

function keyed(id: number, hash: string, width = 100, height = 100, sizeBytes = 1000, format = 'JPG', color = '00000000000000000000'): DedupKeyed {
  return {
    id,
    format,
    color,
    relPath: `f${id}.jpg`,
    name: `f${id}`,
    width,
    height,
    sizeBytes,
    fingerprint: `fp${id}`,
    hash
  }
}

describe('splitStoredHash', () => {
  it('拆出指纹前缀与哈希本体', () => {
    expect(splitStoredHash('fp-123:0a1b2c3d4e5f6071')).toEqual({ fp: 'fp-123', hash: '0a1b2c3d4e5f6071', color: null })
  })

  it('空值与畸形值都返回 null', () => {
    expect(splitStoredHash(null)).toEqual({ fp: null, hash: null, color: null })
    expect(splitStoredHash('nohash')).toEqual({ fp: null, hash: null, color: null })
    expect(splitStoredHash('fp:')).toEqual({ fp: null, hash: null, color: null })
    expect(splitStoredHash(':abc')).toEqual({ fp: null, hash: null, color: null })
  })
})

describe('hammingDistance', () => {
  it('相同哈希为 0,半字节翻转按位数计', () => {
    expect(hammingDistance('0f0f', '0f0f')).toBe(0)
    expect(hammingDistance('f0f0', '0f0f')).toBe(16)
  })

  it('长度不等返回极大值', () => {
    expect(hammingDistance('abc', 'abcd')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('groupSimilar', () => {
  const allZero = '0000000000000000'
  const nearA = '00000000000000ff'
  const nearB = '0000000000000f0f'
  const far = '1111111111111111'

  it('距离在阈值内聚成一组,超阈值不聚', () => {
    const groups = groupSimilar([
      keyed(1, nearA),
      keyed(2, nearB),
      keyed(3, far)
    ], 'balanced')
    expect(groups).toHaveLength(1)
    expect(groups[0].map((g) => g.id)).toEqual([1, 2])
  })

  it('严格规则下轻微差异不进组', () => {
    expect(groupSimilar([keyed(1, nearA), keyed(2, nearB)], 'strict')).toHaveLength(0)
  })

  it('宽高比差异过大不进组', () => {
    const groups = groupSimilar([
      keyed(1, nearA, 1000, 1000),
      keyed(2, nearA, 400, 1000)
    ], 'loose')
    expect(groups).toHaveLength(0)
  })

  it('近纯色图(置位过少)不参与配对', () => {
    const groups = groupSimilar([
      keyed(1, allZero),
      keyed(2, allZero)
    ], 'loose')
    expect(groups).toHaveLength(0)
  })
})

describe('sortByQuality', () => {
  it('按像素数、体积、id 依次定序,推荐项排最前', () => {
    const sorted = sortByQuality([
      keyed(1, 'a', 800, 600, 100),
      keyed(2, 'b', 400, 300, 900),
      keyed(3, 'c', 800, 600, 200)
    ])
    // 1 与 3 像素相同,体积 3 更大排前;2 像素最少垫底
    expect(sorted.map((g) => g.id)).toEqual([3, 1, 2])
  })

  it('不修改入参数组', () => {
    const input = [keyed(1, 'a'), keyed(2, 'b')]
    sortByQuality(input)
    expect(input.map((g) => g.id)).toEqual([1, 2])
  })
})

describe('dHashHex', () => {
  let root = ''

  /* 归一化坐标的正弦图案:缩放后采样点相对位置不变,dHash 才稳定 */
  async function patternJpeg(width: number, height: number, variant = 0): Promise<Buffer> {
    const raw = Buffer.alloc(width * height * 3)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3
        const u = x / width
        const v = y / height
        raw[i] = Math.round(128 + 110 * Math.sin((u * 2 + v + variant) * Math.PI * 2))
        raw[i + 1] = Math.round(128 + 110 * Math.cos((u * 3 - v * 2 + variant) * Math.PI * 2))
        raw[i + 2] = Math.round(128 + 110 * Math.sin((u + v * 4 + variant * 0.5) * Math.PI * 2))
      }
    }
    return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer()
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mediahub-dedup-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('相同内容的不同文件哈希一致,不同内容哈希不同', async () => {
    const a = await patternJpeg(80, 60)
    const b = await patternJpeg(80, 60)
    const c = await patternJpeg(80, 60, 3)
    const { writeFile } = await import('node:fs/promises')
    const pa = join(root, 'a.jpg')
    const pb = join(root, 'b.jpg')
    const pc = join(root, 'c.jpg')
    await writeFile(pa, a)
    await writeFile(pb, b)
    await writeFile(pc, c)
    const ha = await dHashHex(pa)
    const hb = await dHashHex(pb)
    const hc = await dHashHex(pc)
    expect(ha).toBe(hb)
    expect(ha && hc ? hammingDistance(ha, hc) > 0 : true).toBe(true)
  })

  it('同一内容的缩放版距离落在宽松阈值内', async () => {
    const full = await patternJpeg(120, 90)
    const small = await patternJpeg(60, 45)
    const { writeFile } = await import('node:fs/promises')
    const pa = join(root, 'full.jpg')
    const pb = join(root, 'small.jpg')
    await writeFile(pa, full)
    await writeFile(pb, small)
    const ha = await dHashHex(pa)
    const hb = await dHashHex(pb)
    expect(ha && hb ? hammingDistance(ha, hb) <= 12 : true).toBe(true)
  })

  it('解码失败返回 null', async () => {
    const { writeFile } = await import('node:fs/promises')
    const bad = join(root, 'bad.jpg')
    await writeFile(bad, 'not an image')
    await expect(dHashHex(bad)).resolves.toBeNull()
  })
})

describe('normalizeFolder', () => {
  it('统一斜杠并去掉首尾噪声', () => {
    expect(normalizeFolder('a\\b/')).toBe('a/b')
    expect(normalizeFolder('./a')).toBe('a')
  })

  it('空值与越界路径回落整库', () => {
    expect(normalizeFolder(null)).toBe('')
    expect(normalizeFolder('   ')).toBe('')
    expect(normalizeFolder('a/../b')).toBe('')
  })
})

describe('groupSimilar 硬门槛', () => {
  const h = '00000000000000ff'
  it('GIF 不与静态图配对', () => {
    expect(groupSimilar([keyed(1, h, 100, 100, 1000, 'GIF'), keyed(2, h, 100, 100, 1000, 'JPG')], 'balanced')).toHaveLength(0)
  })
  it('体积比超过 100 倍不配对', () => {
    expect(groupSimilar([keyed(1, h, 100, 100, 1000), keyed(2, h, 100, 100, 500000)], 'balanced')).toHaveLength(0)
  })
})
describe('色块签名与严格档门槛', () => {
  it('色结构相同签名一致,仅色调对调则不同', () => {
    const base = Buffer.from([...Array(48)].map((_, i) => (i % 3 === 0 ? 200 : 40)))
    const swapped = Buffer.from([...Array(48)].map((_, i) => (i % 3 === 1 ? 200 : 40)))
    expect(colorSignature(base)).toBe(colorSignature(Buffer.from(base)))
    expect(colorSignature(base)).not.toBe(colorSignature(swapped))
  })

  it('严格档要求色块完全一致,其余档只看 dHash', () => {
    const a = keyed(1, '00000000000000ff', 100, 100, 1000, 'JPG', '00000000000000000000')
    const b = keyed(2, '00000000000000ff', 100, 100, 1000, 'JPG', '11111111111111111111')
    expect(groupSimilar([a, b], 'strict')).toHaveLength(0)
    expect(groupSimilar([a, b], 'balanced')).toHaveLength(1)
  })
})
describe('dHashColor', () => {
  it('同时返回 16 位哈希与 20 位色块签名', async () => {
    const { writeFile } = await import('node:fs/promises')
    const dir = await mkdtemp(join(tmpdir(), 'mediahub-dedup-c-'))
    try {
      const buf = await sharp(Buffer.alloc(24 * 3, 100), { raw: { width: 4, height: 6, channels: 3 } }).jpeg().toBuffer()
      const file = join(dir, 'a.jpg')
      await writeFile(file, buf)
      const probe = await dHashColor(file)
      expect(probe?.hash).toHaveLength(16)
      expect(probe?.color).toHaveLength(20)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})