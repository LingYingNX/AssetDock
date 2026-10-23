import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_HDR, HDR_PRESETS, hdrPreset, parseHdrPreset } from '../src/renderer/src/data/hdr-presets'

const HDRI_DIR = fileURLToPath(new URL('../src/renderer/public/hdri/', import.meta.url))

describe('HDR presets', () => {
  it('ships the 8 Blender worlds with forest as default', () => {
    expect(HDR_PRESETS.map((p) => p.id)).toEqual([
      'city',
      'courtyard',
      'forest',
      'interior',
      'night',
      'studio',
      'sunrise',
      'sunset'
    ])
    expect(DEFAULT_HDR).toBe('forest')
    expect(hdrPreset('forest').url).toBe('hdri/forest.exr')
    expect(hdrPreset('forest').thumbUrl).toBe('hdri/thumbs/forest.png')
  })

  it('falls back to forest for unknown stored values', () => {
    expect(parseHdrPreset('volcano')).toBe('forest')
    expect(parseHdrPreset(null)).toBe('forest')
    expect(parseHdrPreset('sunset')).toBe('sunset')
  })

  it('bundles real EXR files, not LFS pointers', () => {
    for (const preset of HDR_PRESETS) {
      const path = `${HDRI_DIR}${preset.id}.exr`
      const thumbPath = `${HDRI_DIR}thumbs/${preset.id}.png`
      expect(existsSync(path), preset.id).toBe(true)
      expect(existsSync(thumbPath), `${preset.id} thumb`).toBe(true)
      // LFS 指针只有 131 字节;真实 1K EXR 每个约 98–553KB
      expect(statSync(path).size, preset.id).toBeGreaterThan(50_000)
    }
  })
})
